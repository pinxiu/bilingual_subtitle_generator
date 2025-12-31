
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import { Job, Cue, RenderConfig, JobResult } from './types.js';
import { parseSrt, buildSrt } from './utils.js';

const DATA_DIR = path.resolve((process as any).cwd(), 'data');

// PART 1: AI Processing (Transcribe -> Translate -> SRT)
export const processJobInitial = async (job: Job, updateJob: (id: string, partial: Partial<Job>) => void) => {
  const jobDir = path.join(DATA_DIR, job.id);
  const inputPath = job.filePath!;
  const srtPath = path.join(jobDir, 'bilingual.srt');

  try {
    // Simulated Python interaction (would normally pass new flags to ai_service.py)
    // We would pass: job.sourceLang, job.outputFormat, job.enTranscript, job.zhTranscript
    
    const pythonScript = path.join((process as any).cwd(), 'ai_service.py');
    const pythonCommand = (process as any).platform === 'win32' ? 'python' : 'python3';
    
    // In a real implementation, we'd add these args:
    // [pythonScript, inputPath, srtPath, '--source-lang', job.sourceLang, '--format', job.outputFormat, ...]
    
    await new Promise<void>((resolve, reject) => {
      // Stubbing the call with existing structure but logic would change inside Python script
      const venvPython =
        process.platform === "win32"
          ? path.join(process.cwd(), ".venv", "Scripts", "python.exe")
          : path.join(process.cwd(), ".venv", "bin", "python");

      const python = spawn(venvPython, [pythonScript, inputPath, srtPath], {
        env: {
          ...process.env,
          STANZA_RESOURCES_DIR: path.join(process.cwd(), ".stanza"),
        },
      });

      // Catch spawn errors (e.g., ENOENT if python is missing)
      python.on('error', (err) => {
        reject(new Error(`Failed to spawn python command "${pythonCommand}". Make sure Python is installed. Details: ${err.message}`));
      });

      python.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.stage) {
              updateJob(job.id, { 
                stage: msg.stage, 
                progress: msg.progress, 
                message: msg.message 
              });
            }
          } catch (e) {
            console.log(`[Python Log]: ${line}`);
          }
        }
      });

      let errorOutput = '';
      python.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error(`[Python Error]: ${data}`);
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`AI Service failed: ${errorOutput || 'Unknown error'}`));
        } else {
          resolve();
        }
      });
    });

    if (!fs.existsSync(srtPath)) {
      throw new Error("SRT file was not generated.");
    }
    const srtContent = fs.readFileSync(srtPath, 'utf-8');
    const cues = parseSrt(srtContent);

    // Filter cues based on user preference if Python script didn't handle it
    const processedCues = cues.map(c => {
        const final = { ...c };
        if (job.outputFormat === 'en') final.zh = '';
        if (job.outputFormat === 'zh') final.en = '';
        return final;
    });

    updateJob(job.id, { 
      status: 'waiting_for_approval',
      stage: 'user_review',
      progress: 60, 
      message: 'Waiting for subtitle review',
      result: {
        rawVideoUrl: `/api/stream/${job.id}`,
        previewCues: processedCues
      }
    });

  } catch (error: any) {
    console.error("Job Initial failed:", error);
    updateJob(job.id, { 
      status: 'error', 
      message: 'AI Processing failed', 
      error: error.message || 'Unknown error' 
    });
  }
};

// PART 2: Rendering (Soft Sub -> Hard Sub)
export const processJobFinalize = async (job: Job, updateJob: (id: string, partial: Partial<Job>) => void, config?: RenderConfig) => {
  const jobDir = path.join(DATA_DIR, job.id);
  const inputPath = job.filePath!;
  const srtPath = path.join(jobDir, 'bilingual.srt');
  const softVideoPath = path.join(jobDir, 'output_soft.mp4');
  const burnVideoPath = path.join(jobDir, 'output_burned.mp4');

  const safeConfig: RenderConfig = config || {
    renderSoft: true,
    renderBurn: true,
    burnConfig: {
      fontSize: 16,
      fontName: 'Arial',
      primaryColour: '&H00FFFFFF',
      outlineColour: '&H80000000',
      backColour: '&H80000000',
      bold: false,
      borderStyle: 1, 
      outline: 2,
      shadow: 0,
      marginV: 20,
      lineHeight: 1.2
    }
  };

  try {
    // Normalize subtitle mode (fallback to bilingual if not specified)
    const subtitleMode = safeConfig.subtitleMode || 'bilingual';

    // Create a filtered SRT file for rendering (preserve original bilingual.srt for editing)
    let renderSrtPath = path.join(jobDir, 'render_temp.srt');
    const outputSrtPath = path.join(jobDir, 'output_srt.srt'); // For download
    
    if (fs.existsSync(srtPath)) {
      const originalSrt = fs.readFileSync(srtPath, 'utf-8');
      const originalCues = parseSrt(originalSrt);

      // Only filter if not bilingual (to preserve original when bilingual)
      const filteredCues: Cue[] = subtitleMode === 'bilingual' 
        ? originalCues 
        : originalCues.map(c => {
            const next = { ...c };
            if (subtitleMode === 'en') {
              next.zh = '';
            } else if (subtitleMode === 'zh') {
              next.en = '';
            }
            return next;
          });

      const filteredSrt = buildSrt(filteredCues);
      // Write filtered version for rendering and download
      fs.writeFileSync(renderSrtPath, filteredSrt, 'utf-8');
      fs.writeFileSync(outputSrtPath, filteredSrt, 'utf-8');
    } else {
      // Fallback: use bilingual.srt if it doesn't exist
      renderSrtPath = srtPath;
    }

    if (safeConfig.renderSoft) {
        updateJob(job.id, { status: 'processing', stage: 'render_soft', progress: 85, message: 'Muxing soft subtitles stream...' });
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(inputPath)
            .input(renderSrtPath)
            .outputOptions('-c copy') 
            .outputOptions('-c:s mov_text')
            .save(softVideoPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(new Error(`Soft sub failed: ${err.message}`)));
        });
    }

    if (safeConfig.renderBurn) {
        updateJob(job.id, { stage: 'render_burn', progress: 90, message: 'Burning subtitles (this takes time)...' });
        await new Promise<void>((resolve, reject) => {
           const escapedSrtPath = renderSrtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
           const c = safeConfig.burnConfig!;
           const styleParts = [
             `FontName=${c.fontName || 'Arial'}`,
             `FontSize=${c.fontSize}`,
             `PrimaryColour=${c.primaryColour}`,
             `OutlineColour=${c.outlineColour}`,
             `BackColour=${c.backColour || '&H80000000'}`,
             `BorderStyle=${c.borderStyle}`,
             `Outline=${c.outline}`,
             `Shadow=${c.shadow}`,
             `MarginV=${c.marginV}`,
             `Bold=${c.bold ? 1 : 0}`
           ];
           const style = styleParts.join(',');

           ffmpeg(inputPath)
             .outputOptions('-vf', `subtitles='${escapedSrtPath}':force_style='${style}'`)
             .videoCodec('libx264')
             .audioCodec('copy')
             .save(burnVideoPath)
             .on('end', () => resolve())
             .on('error', (err) => reject(new Error(`Burn sub failed: ${err.message}`)));
        });
    }

    // For editor, use the original bilingual cues so user can switch languages later
    const originalSrtContent = fs.readFileSync(srtPath, 'utf-8');
    const originalCues = parseSrt(originalSrtContent);

    const result: JobResult = {
        previewCues: originalCues,
        // For final preview, show what was actually rendered (filtered SRT),
        // falling back to bilingual if for some reason the filtered file is missing.
        renderedPreviewCues: fs.existsSync(outputSrtPath)
          ? parseSrt(fs.readFileSync(outputSrtPath, 'utf-8'))
          : originalCues,
        renderedSubtitleMode: subtitleMode,
        srtUrl: `/api/download/${job.id}/srt`,
    };

    if (safeConfig.renderSoft && fs.existsSync(softVideoPath)) {
        result.softVideoUrl = `/api/download/${job.id}/soft`;
    }
    if (safeConfig.renderBurn && fs.existsSync(burnVideoPath)) {
        result.burnVideoUrl = `/api/download/${job.id}/burn`;
    }

    updateJob(job.id, { 
      status: 'done', 
      stage: 'complete', 
      progress: 100, 
      message: 'Processing complete!',
      result
    });

  } catch (error: any) {
    console.error("Job Finalize failed:", error);
    updateJob(job.id, { 
      status: 'error', 
      message: 'Rendering failed', 
      error: error.message || 'Unknown error' 
    });
  }
};
