
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { Job, Cue, RenderConfig, SourceLanguage, OutputFormat } from './types.js';
import { processJobInitial, processJobFinalize } from './processor.js';
import { buildSrt, parseSrt } from './utils.js';

const app = express();
const PORT = 3001;

app.use(cors({ origin: '*' }) as any);
app.use(express.json({ limit: '50mb' }) as any);

const jobs = new Map<string, Job>();

const DATA_DIR = path.resolve((process as any).cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DATA_DIR);
  },
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + cleanName);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4GB limit
});

const updateJobStatus = (id: string, partial: Partial<Job>) => {
  const job = jobs.get(id);
  if (job) {
    jobs.set(id, { ...job, ...partial });
  }
};

app.post('/api/upload', upload.single('file') as any, (req: any, res: any): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const jobId = uuidv4();
  const jobDir = path.join(DATA_DIR, jobId);
  fs.mkdirSync(jobDir);

  const newPath = path.join(jobDir, req.file.filename);
  fs.renameSync(req.file.path, newPath);

  const { sourceLang, outputFormat, lineCount, enTranscript, zhTranscript } = req.body;

  const newJob: Job = {
    id: jobId,
    status: 'queued',
    stage: 'upload',
    progress: 0,
    filePath: newPath,
    originalFilename: req.file.originalname,
    createdAt: Date.now(),
    sourceLang: (sourceLang as SourceLanguage) || 'en',
    outputFormat: (outputFormat as OutputFormat) || 'bilingual',
    lineCount: lineCount ? parseInt(lineCount) : (outputFormat === 'bilingual' ? 2 : 1),
    enTranscript,
    zhTranscript
  };

  jobs.set(jobId, newJob);
  processJobInitial(newJob, updateJobStatus);
  res.json({ jobId });
});

app.post('/api/upload-existing', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'srt', maxCount: 1 }]) as any, (req: any, res: any): void => {
  const files = req.files as { [fieldname: string]: any[] };
  
  if (!files || !files['video'] || !files['srt']) {
    res.status(400).json({ error: 'Both video and SRT files are required' });
    return;
  }

  const videoFile = files['video'][0];
  const srtFile = files['srt'][0];

  const jobId = uuidv4();
  const jobDir = path.join(DATA_DIR, jobId);
  fs.mkdirSync(jobDir);

  const videoPath = path.join(jobDir, videoFile.filename);
  fs.renameSync(videoFile.path, videoPath);

  const srtPath = path.join(jobDir, 'bilingual.srt');
  fs.renameSync(srtFile.path, srtPath);

  const srtContent = fs.readFileSync(srtPath, 'utf-8');
  let cues: Cue[] = [];
  try {
    cues = parseSrt(srtContent);
  } catch (e) {
    console.error("Failed to parse uploaded SRT", e);
  }

  const newJob: Job = {
    id: jobId,
    status: 'waiting_for_approval', 
    stage: 'user_review',
    progress: 60,
    filePath: videoPath,
    originalFilename: videoFile.originalname,
    createdAt: Date.now(),
    result: {
      rawVideoUrl: `/api/stream/${jobId}`,
      previewCues: cues
    }
  };

  jobs.set(jobId, newJob);
  res.json({ jobId });
});

app.get('/api/jobs', (req: any, res: any) => {
  try {
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
    const availableJobs = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const jobId = entry.name;
        const jobDir = path.join(DATA_DIR, jobId);
        
        const srtExists = fs.existsSync(path.join(jobDir, 'bilingual.srt'));
        if (!srtExists) continue;

        const files = fs.readdirSync(jobDir);
        const videoFile = files.find(f => 
          !f.startsWith('output_') && 
          f !== 'bilingual.srt' &&
          ['.mp4', '.mov', '.avi', '.mkv'].includes(path.extname(f).toLowerCase())
        );

        if (videoFile) {
           const stats = fs.statSync(path.join(jobDir, 'bilingual.srt'));
           
           // Check for metadata
           let displayName = videoFile;
           const metaPath = path.join(jobDir, 'metadata.json');
           if (fs.existsSync(metaPath)) {
             try {
               const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
               if (meta.displayName) {
                 displayName = meta.displayName;
               }
             } catch (e) {
               // ignore corrupted metadata
             }
           }

           availableJobs.push({
             id: jobId,
             originalFilename: displayName, 
             createdAt: stats.birthtimeMs,
             lastModified: stats.mtimeMs
           });
        }
      }
    }
    availableJobs.sort((a, b) => b.lastModified - a.lastModified);
    res.json(availableJobs);
  } catch (err) {
    console.error("Failed to list jobs", err);
    res.status(500).json({ error: "Failed to list jobs" });
  }
});

app.post('/api/job/:jobId/rename', (req: any, res: any) => {
  const { jobId } = req.params;
  const { newName } = req.body;

  if (!newName || typeof newName !== 'string' || !newName.trim()) {
      return res.status(400).json({ error: "Invalid name" });
  }

  const jobDir = path.join(DATA_DIR, jobId);
  if (!fs.existsSync(jobDir)) {
      return res.status(404).json({ error: "Job not found" });
  }

  const metaPath = path.join(jobDir, 'metadata.json');
  let meta: any = {};
  if (fs.existsSync(metaPath)) {
      try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch (e) {
          // start fresh
      }
  }

  meta.displayName = newName.trim();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  // If job is in memory, update it too
  const job = jobs.get(jobId);
  if (job) {
      job.originalFilename = meta.displayName;
  }

  res.json({ success: true, name: meta.displayName });
});

app.delete('/api/job/:jobId', (req: any, res: any) => {
  const { jobId } = req.params;
  const jobDir = path.join(DATA_DIR, jobId);

  if (fs.existsSync(jobDir)) {
      try {
          fs.rmSync(jobDir, { recursive: true, force: true });
      } catch (e) {
          console.error("Failed to delete job dir", e);
          return res.status(500).json({ error: "Failed to delete project files" });
      }
  }

  jobs.delete(jobId);
  res.json({ success: true });
});

app.post('/api/job/:jobId/load', (req: any, res: any) => {
    const { jobId } = req.params;
    if (jobs.has(jobId)) {
        return res.json({ jobId });
    }

    const jobDir = path.join(DATA_DIR, jobId);
    if (!fs.existsSync(jobDir)) {
        return res.status(404).json({ error: "Job files not found" });
    }

    const files = fs.readdirSync(jobDir);
    const videoFile = files.find(f => 
        !f.startsWith('output_') && 
        f !== 'bilingual.srt' &&
        ['.mp4', '.mov', '.avi', '.mkv'].includes(path.extname(f).toLowerCase())
    );
    if (!videoFile) return res.status(404).json({error: "Video file missing"});

    // Check for metadata
    let displayName = videoFile;
    const metaPath = path.join(jobDir, 'metadata.json');
    if (fs.existsSync(metaPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (meta.displayName) {
                displayName = meta.displayName;
            }
        } catch (e) {
            // ignore
        }
    }

    const videoPath = path.join(jobDir, videoFile);
    const srtPath = path.join(jobDir, 'bilingual.srt');
    const srtContent = fs.readFileSync(srtPath, 'utf-8');
    const cues = parseSrt(srtContent);

    const job: Job = {
        id: jobId,
        status: 'waiting_for_approval',
        stage: 'user_review',
        progress: 60,
        filePath: videoPath,
        originalFilename: displayName,
        createdAt: Date.now(), 
        result: {
            rawVideoUrl: `/api/stream/${jobId}`,
            previewCues: cues
        }
    };
    
    jobs.set(jobId, job);
    res.json({ jobId });
});

app.get('/api/status/:jobId', (req: any, res: any) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

app.get('/api/stream/:jobId', (req: any, res: any) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.filePath) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  const stat = fs.statSync(job.filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(job.filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(job.filePath).pipe(res);
  }
});

app.post('/api/job/:jobId/update', (req: any, res: any) => {
  const { jobId } = req.params;
  const { cues }: { cues: Cue[] } = req.body;
  const job = jobs.get(jobId);

  if (!job) return res.status(404).json({ error: 'Job not found' });

  try {
    const srtContent = buildSrt(cues);
    const srtPath = path.join(DATA_DIR, jobId, 'bilingual.srt');
    fs.writeFileSync(srtPath, srtContent);
    if (job.result) {
      job.result.previewCues = cues;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to write SRT' });
  }
});

app.post('/api/job/:jobId/resume', (req: any, res: any) => {
  const { jobId } = req.params;
  const { config }: { config?: RenderConfig } = req.body;
  const job = jobs.get(jobId);

  if (!job) return res.status(404).json({ error: 'Job not found' });
  processJobFinalize(job, updateJobStatus, config);
  res.json({ success: true });
});

app.get('/api/download/:jobId/:type', (req: any, res: any) => {
  const { jobId, type } = req.params;
  const job = jobs.get(jobId);

  if (!job || job.status !== 'done' || !job.result) {
    return res.status(404).json({ error: 'File not ready or job not found' });
  }

  const jobDir = path.join(DATA_DIR, jobId);
  let filePath = '';
  let downloadName = '';

  const { srtFilename, softVideoFilename, burnVideoFilename } = job.result;

  // Generate safe filename from current project name
  const safeName = job.originalFilename.replace(/[^a-zA-Z0-9.\-_ \u4e00-\u9fa5]/g, '_'); // allow chinese chars too
  const stem = path.parse(safeName).name;

  switch (type) {
    case 'srt':
      // Use output_srt.srt if it exists (filtered version from last render), otherwise fallback to bilingual.srt
      const outputSrtPath = path.join(jobDir, 'output_srt.srt');
      filePath = fs.existsSync(outputSrtPath) ? outputSrtPath : path.join(jobDir, 'bilingual.srt');
      downloadName = `${stem}.srt`;
      break;
    case 'soft':
      filePath = path.join(jobDir, softVideoFilename || 'output_soft.mp4');
      downloadName = `${stem}_soft.mp4`;
      break;
    case 'burn':
      filePath = path.join(jobDir, burnVideoFilename || 'output_burned.mp4');
      downloadName = `${stem}.mp4`;
      break;
    default:
      return res.status(400).json({ error: 'Invalid type' });
  }

  if (fs.existsSync(filePath)) {
    res.download(filePath, downloadName);
  } else {
    res.status(404).json({ error: 'File on disk not found' });
  }
});

app.use((err: any, req: Request, res: any, next: NextFunction) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `Upload error: ${err.message}` });
  } else if (err) {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
