import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import express, { Request, Response, RequestHandler, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { Job } from './types.js';
import { processJob } from './processor.js';

const app = express();
const PORT = 3001;

// Middleware
// Allow all origins to prevent CORS Network Errors during dev
app.use(cors({ origin: '*' }));
app.use(express.json());

// Job Store (In-Memory)
const jobs = new Map<string, Job>();

// Storage setup
const DATA_DIR = path.resolve((process as any).cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Temporary upload location, will move to job folder later or keep flat
    cb(null, DATA_DIR);
  },
  filename: (req, file, cb) => {
    // Sanitize filename roughly to prevent some FS issues
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + cleanName);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB limit
});

// Routes

// 1. Upload
app.post('/api/upload', upload.single('file'), (req: any, res: any): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const jobId = uuidv4();
  const jobDir = path.join(DATA_DIR, jobId);
  fs.mkdirSync(jobDir);

  // Move file to job dir for containment
  const newPath = path.join(jobDir, req.file.filename); // Use multer generated filename
  fs.renameSync(req.file.path, newPath);

  const newJob: Job = {
    id: jobId,
    status: 'queued',
    stage: 'upload',
    progress: 0,
    filePath: newPath,
    originalFilename: req.file.originalname,
    createdAt: Date.now()
  };

  jobs.set(jobId, newJob);
  
  // Trigger background processing
  processJob(newJob, (id, partial) => {
    const job = jobs.get(id);
    if (job) {
      jobs.set(id, { ...job, ...partial });
    }
  });

  res.json({ jobId });
});

// 2. Status
app.get('/api/status/:jobId', (req: any, res: any) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// 3. Download
app.get('/api/download/:jobId/:type', (req: any, res: any) => {
  const { jobId, type } = req.params;
  const job = jobs.get(jobId);

  if (!job || job.status !== 'done') {
    return res.status(404).json({ error: 'File not ready or job not found' });
  }

  const jobDir = path.join(DATA_DIR, jobId);
  let filePath = '';
  let downloadName = '';

  switch (type) {
    case 'srt':
      filePath = path.join(jobDir, 'bilingual.srt');
      downloadName = 'subtitles.srt';
      break;
    case 'soft':
      filePath = path.join(jobDir, 'output_soft.mkv');
      downloadName = 'video_soft_subs.mkv';
      break;
    case 'burn':
      filePath = path.join(jobDir, 'output_burned.mp4');
      downloadName = 'video_burned_subs.mp4';
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

// Global Error Handler to catch Multer errors and prevent "Network Error" on client
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
  console.log(`Data directory: ${DATA_DIR}`);
});