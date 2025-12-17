
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import { Job, Cue, RenderConfig, JobResult } from './types.js';
import { parseSrt } from './utils.js';

const DATA_DIR = path.resolve((process as any).cwd(), 'data');

// PART 1: AI Processing (Transcribe -> Translate -> SRT)
export const processJobInitial = async (job: Job, updateJob: (id: string, partial: Partial<Job>) => void) => {
  const jobDir = path.join(DATA_DIR, job.id);
  const inputPath = job.filePath!;
  const srtPath = path.join(jobDir, 'bilingual.srt');

  try {
    // We spawn a Python process to handle the heavy AI lifting
    const pythonScript = path.join((process as any).cwd(), 'ai_service.py');
    
    // Use 'python3' on macOS/Linux, 'python' on Windows
    const pythonCommand = (process as any).platform === 'win32' ? 'python' : 'python3';
    
    await new Promise<void>((resolve, reject) => {
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

    // Read generated SRT for preview
    if (!fs.existsSync(srtPath)) {
      throw new Error("SRT file was not generated.");
    }
    const srtContent = fs.readFileSync(srtPath, 'utf-8');
    const cues = parseSrt(srtContent);

    // STOP HERE: Update status to 'waiting_for_approval'
    updateJob(job.id, { 
      status: 'waiting_for_approval',
      stage: 'user_review',
      progress: 60, 
      message: 'Waiting for subtitle review',
      result: {
        rawVideoUrl: `/api/stream/${job.id}`, // Allow frontend to play raw video
        previewCues: cues
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

// PART 2: Rendering (Soft Sub -> Hard Sub) - Called after user approval
export const processJobFinalize = async (job: Job, updateJob: (id: string, partial: Partial<Job>) => void, config?: RenderConfig) => {
  const jobDir = path.join(DATA_DIR, job.id);
  const inputPath = job.filePath!;
  const srtPath = path.join(jobDir, 'bilingual.srt');
  const softVideoPath = path.join(jobDir, 'output_soft.mp4');
  const burnVideoPath = path.join(jobDir, 'output_burned.mp4');

  // Default config if not provided
  const safeConfig = config || {
    renderSoft: true,
    renderBurn: true,
    burnConfig: {
      fontSize: 16,
      fontName: 'Arial',
      primaryColour: '&H00FFFFFF',
      outlineColour: '&H80000000',
      backColour: '&H80000000',
      bold: false,
      borderStyle: 1, // Default to Outline now to avoid overlap box issues
      outline: 2,
      shadow: 0,
      marginV: 20,
      lineHeight: 1.2
    }
  };

  try {
    // --- STEP 4: Render Soft Subs (Muxing) ---
    if (safeConfig.renderSoft) {
        updateJob(job.id, { status: 'processing', stage: 'render_soft', progress: 85, message: 'Muxing soft subtitles stream...' });
        
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(inputPath)
            .input(srtPath)
            .outputOptions('-c copy') 
            .outputOptions('-c:s mov_text') // Standard MP4 subtitle codec
            .save(softVideoPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(new Error(`Soft sub failed: ${err.message}`)));
        });
    }

    // --- STEP 5: Render Hard Subs (Burning) ---
    if (safeConfig.renderBurn) {
        updateJob(job.id, { stage: 'render_burn', progress: 90, message: 'Burning subtitles (this takes time)...' });
        
        await new Promise<void>((resolve, reject) => {
           const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
           
           // Construct ForceStyle string from config
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

    // --- STEP 6: Complete ---
    // Re-read cues in case they changed during editing
    const finalSrtContent = fs.readFileSync(srtPath, 'utf-8');
    const finalCues = parseSrt(finalSrtContent);

    // Only return URLs for files that were actually generated
    const result: JobResult = {
        previewCues: finalCues,
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
