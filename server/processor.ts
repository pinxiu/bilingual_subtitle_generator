import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import { Job, Cue } from './types.js';
import { parseSrt } from './utils.js';

const DATA_DIR = path.resolve((process as any).cwd(), 'data');

export const processJob = async (job: Job, updateJob: (id: string, partial: Partial<Job>) => void) => {
  const jobDir = path.join(DATA_DIR, job.id);
  const inputPath = job.filePath!;
  const srtPath = path.join(jobDir, 'bilingual.srt');
  const softVideoPath = path.join(jobDir, 'output_soft.mkv');
  const burnVideoPath = path.join(jobDir, 'output_burned.mp4');

  try {
    // --- STEP 1, 2, 3: AI Service (Transcribe -> Translate -> SRT) ---
    // We spawn a Python process to handle the heavy AI lifting
    const pythonScript = path.join((process as any).cwd(), 'ai_service.py');
    
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
            // Ignore non-JSON stdout (debugging logs from python)
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

    // Read the generated SRT to create the preview
    if (!fs.existsSync(srtPath)) {
      throw new Error("SRT file was not generated.");
    }
    const srtContent = fs.readFileSync(srtPath, 'utf-8');
    const cues = parseSrt(srtContent).slice(0, 50); // Preview first 50 cues

    // --- STEP 4: Render Soft Subs (Muxing) ---
    updateJob(job.id, { stage: 'render_soft', progress: 85, message: 'Muxing soft subtitles stream...' });
    
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(inputPath)   // input 0: video/audio
        .input(srtPath)     // input 1: subtitles
        .outputOptions([
          // Explicit mapping so the subtitle stream is guaranteed to be included
          '-map 0:v:0',
          '-map 0:a?',      // include audio if present
          '-map 1:0',       // include the SRT stream

          // Copy video/audio without re-encoding
          '-c:v copy',
          '-c:a copy',

          // In MKV, store subtitles as SRT (very compatible)
          '-c:s srt',

          // Optional but helpful metadata
          '-metadata:s:s:0 language=eng',
          '-disposition:s:0 default',
        ])
        .save(softVideoPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Soft sub MKV failed: ${err.message}`)));
    });

    // --- STEP 5: Render Hard Subs (Burning) ---
    updateJob(job.id, { stage: 'render_burn', progress: 90, message: 'Burning subtitles (this takes time)...' });
    
    await new Promise<void>((resolve, reject) => {
       // Escape path for ffmpeg filter: replace backslashes with forward slashes, escape colons
       // On Windows, paths like C:\foo need to become C\:/foo in some contexts, 
       // but fluent-ffmpeg + standard filter syntax usually works best with forward slashes.
       const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

       // Use force_style to ensure a readable font. 
       // 'Arial Unicode MS' or 'Noto Sans CJK SC' covers Chinese. 
       // If not found, FFmpeg usually falls back or shows boxes, but standard defaults often work.
       // Outline and generic sans-serif is a safe baseline.
       const style = "Fontname=Arial,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=20";

       ffmpeg(inputPath)
         .outputOptions('-vf', `subtitles='${escapedSrtPath}':force_style='${style}'`)
         .videoCodec('libx264')
         .audioCodec('copy')
         .save(burnVideoPath)
         .on('end', () => resolve())
         .on('error', (err) => reject(new Error(`Burn sub failed: ${err.message}`)));
    });

    // --- STEP 6: Complete ---
    updateJob(job.id, { 
      status: 'done', 
      stage: 'complete', 
      progress: 100, 
      message: 'Processing complete!',
      result: {
        srtUrl: `/api/download/${job.id}/srt`,
        softVideoUrl: `/api/download/${job.id}/soft`,
        burnVideoUrl: `/api/download/${job.id}/burn`,
        previewCues: cues
      }
    });

  } catch (error: any) {
    console.error("Job failed:", error);
    updateJob(job.id, { 
      status: 'error', 
      message: 'Processing failed', 
      error: error.message || 'Unknown error' 
    });
  }
};
