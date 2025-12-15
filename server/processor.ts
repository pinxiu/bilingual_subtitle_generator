import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { Job, Cue } from './types.js';
import { formatSrtTime, SIMULATED_TRANSCRIPT } from './utils.js';

const DATA_DIR = path.resolve((process as any).cwd(), 'data');

export const processJob = async (job: Job, updateJob: (id: string, partial: Partial<Job>) => void) => {
  const jobDir = path.join(DATA_DIR, job.id);
  const inputPath = job.filePath!;
  const srtPath = path.join(jobDir, 'bilingual.srt');
  const softVideoPath = path.join(jobDir, 'output_soft.mkv');
  const burnVideoPath = path.join(jobDir, 'output_burned.mp4');

  try {
    // 1. Transcribe (Simulated)
    updateJob(job.id, { status: 'processing', stage: 'transcribe', progress: 10, message: 'Extracting audio & transcribing...' });
    await new Promise(r => setTimeout(r, 2000)); // Fake processing time

    // 2. Translate (Simulated)
    updateJob(job.id, { stage: 'translate', progress: 30, message: 'Translating content to Chinese...' });
    await new Promise(r => setTimeout(r, 2000)); // Fake processing time

    // 3. Generate SRT
    updateJob(job.id, { stage: 'srt', progress: 50, message: 'Formatting bilingual subtitles...' });
    
    const cues: Cue[] = SIMULATED_TRANSCRIPT.map(t => ({
      start: formatSrtTime(t.start),
      end: formatSrtTime(t.end),
      en: t.en,
      zh: t.zh
    }));

    const srtContent = cues.map((cue, index) => {
      return `${index + 1}\n${cue.start} --> ${cue.end}\n${cue.en}\n${cue.zh}\n`;
    }).join('\n');

    fs.writeFileSync(srtPath, srtContent, 'utf-8');

    // 4. Render Soft Subs (Muxing) -> MKV (reliable soft subs)
    updateJob(job.id, { stage: 'render_soft', progress: 60, message: 'Muxing soft subtitles into MKV...' });

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

    // 5. Render Hard Subs (Burning)
    // Note: Burning requires re-encoding, so it's slower.
    updateJob(job.id, { stage: 'render_burn', progress: 80, message: 'Burning subtitles into video (this may take a while)...' });
    
    // We must escape the path for ffmpeg filter
    // On Windows/Linux handling can differ, fluent-ffmpeg handles mostly but complex filters need care.
    // We use relative path to avoid some escaping hell in filters if possible, or simple standard path.
    // For robustness in this demo, we might skip complex font checks and use default font.
    // Warning: 'subtitles' filter requires a fairly modern ffmpeg build.
    
    await new Promise<void>((resolve, reject) => {
       // Escape colons and backslashes for the filter string
       const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

       ffmpeg(inputPath)
         .outputOptions('-vf', `subtitles='${escapedSrtPath}':force_style='Fontsize=18,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=3'`)
         .videoCodec('libx264')
         .audioCodec('copy') // Preserve audio
         .save(burnVideoPath)
         .on('end', () => resolve())
         .on('error', (err) => reject(new Error(`Burn sub failed: ${err.message}`)));
    });

    // 6. Complete
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