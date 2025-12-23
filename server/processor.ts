import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import { Job, RenderConfig, JobResult } from './types.js';
import { parseSrt, buildSrt } from './utils.js';

const DATA_DIR = path.resolve((process as any).cwd(), 'data');

const getVenvPython = () =>
  process.platform === 'win32'
    ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
    : path.join(process.cwd(), '.venv', 'bin', 'python');

const runAiService = async (
  args: string[],
  updateJob: (id: string, partial: Partial<Job>) => void,
  jobId: string
) => {
  const pythonScript = path.join((process as any).cwd(), 'ai_service.py');
  const venvPython = getVenvPython();

  await new Promise<void>((resolve, reject) => {
    const python = spawn(venvPython, [pythonScript, ...args], {
      env: {
        ...process.env,
        STANZA_RESOURCES_DIR: path.join(process.cwd(), '.stanza'),
      },
    });

    python.on('error', (err) => {
      reject(
        new Error(
          `Failed to spawn python at "${venvPython}". Make sure venv exists and dependencies are installed. Details: ${err.message}`
        )
      );
    });

    python.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.stage) {
            updateJob(jobId, {
              stage: msg.stage,
              progress: msg.progress,
              message: msg.message,
            });
          }
        } catch {
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
};

// PART 1: AI Processing (Transcribe -> Translate -> SRT)
export const processJobInitial = async (job: Job, updateJob: (id: string, partial: Partial<Job>) => void) => {
  const jobDir = path.join(DATA_DIR, job.id);
  const inputPath = job.filePath!;
  const srtPath = path.join(jobDir, 'bilingual.srt');

  try {
    await runAiService([inputPath, srtPath], updateJob, job.id);

    if (!fs.existsSync(srtPath)) throw new Error('SRT file was not generated.');
    const srtContent = fs.readFileSync(srtPath, 'utf-8');
    const cues = parseSrt(srtContent);

    const processedCues = cues.map((c) => {
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
        previewCues: processedCues,
      },
    });
  } catch (error: any) {
    console.error('Job Initial failed:', error);
    updateJob(job.id, {
      status: 'error',
      message: 'AI Processing failed',
      error: error.message || 'Unknown error',
    });
  }
};

// PART 1.5: Re-translate existing SRT (use ai_service.py, not simulation)
export const processJobRetranslate = async (job: Job, updateJob: (id: string, partial: Partial<Job>) => void) => {
  const jobDir = path.join(DATA_DIR, job.id);
  const inputSrtPath = path.join(jobDir, 'input.srt');
  const outputSrtPath = path.join(jobDir, 'bilingual.srt');

  try {
    updateJob(job.id, {
      status: 'processing',
      stage: 'translate',
      progress: 40,
      message: 'Rerunning translation step...',
    });

    if (!fs.existsSync(inputSrtPath)) {
      throw new Error(`Input SRT not found: ${inputSrtPath}`);
    }

    /**
     * We reuse ai_service.py by giving it an SRT input instead of audio/video.
     * This requires ai_service.py to support:
     *   python ai_service.py --input_srt <inputSrtPath> <outputSrtPath>
     *
     * If your ai_service.py instead uses a different flag, adjust args below.
     */
    await runAiService(['--input_srt', inputSrtPath, outputSrtPath], updateJob, job.id);

    if (!fs.existsSync(outputSrtPath)) throw new Error('Bilingual SRT file was not generated.');
    const outContent = fs.readFileSync(outputSrtPath, 'utf-8');
    const improvedCues = parseSrt(outContent);

    // Respect output format filtering as before
    const processedCues = improvedCues.map((c) => {
      const final = { ...c };
      if (job.outputFormat === 'en') final.zh = '';
      if (job.outputFormat === 'zh') final.en = '';
      return final;
    });

    updateJob(job.id, {
      status: 'waiting_for_approval',
      stage: 'user_review',
      progress: 60,
      message: 'Improved translation ready for review',
      result: {
        rawVideoUrl: `/api/stream/${job.id}`,
        previewCues: processedCues,
      },
    });
  } catch (error: any) {
    console.error('Job Retranslate failed:', error);
    updateJob(job.id, {
      status: 'error',
      message: 'Re-translation failed',
      error: error.message || 'Unknown error',
    });
  }
};

// PART 2: Rendering (Soft Sub -> Hard Sub)
export const processJobFinalize = async (
  job: Job,
  updateJob: (id: string, partial: Partial<Job>) => void,
  config?: RenderConfig
) => {
  const jobDir = path.join(DATA_DIR, job.id);
  const inputPath = job.filePath!;
  const srtPath = path.join(jobDir, 'bilingual.srt');
  const softVideoPath = path.join(jobDir, 'output_soft.mp4');
  const burnVideoPath = path.join(jobDir, 'output_burned.mp4');

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
      borderStyle: 1,
      outline: 2,
      shadow: 0,
      marginV: 20,
      lineHeight: 1.2,
    },
  };

  try {
    if (safeConfig.renderSoft) {
      updateJob(job.id, { status: 'processing', stage: 'render_soft', progress: 85, message: 'Muxing soft subtitles stream...' });
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(inputPath)
          .input(srtPath)
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
        const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
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
          `Bold=${c.bold ? 1 : 0}`,
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

    const finalSrtContent = fs.readFileSync(srtPath, 'utf-8');
    const finalCues = parseSrt(finalSrtContent);

    const result: JobResult = {
      previewCues: finalCues,
      srtUrl: `/api/download/${job.id}/srt`,
    };

    if (safeConfig.renderSoft && fs.existsSync(softVideoPath)) result.softVideoUrl = `/api/download/${job.id}/soft`;
    if (safeConfig.renderBurn && fs.existsSync(burnVideoPath)) result.burnVideoUrl = `/api/download/${job.id}/burn`;

    updateJob(job.id, {
      status: 'done',
      stage: 'complete',
      progress: 100,
      message: 'Processing complete!',
      result,
    });
  } catch (error: any) {
    console.error('Job Finalize failed:', error);
    updateJob(job.id, {
      status: 'error',
      message: 'Rendering failed',
      error: error.message || 'Unknown error',
    });
  }
};
