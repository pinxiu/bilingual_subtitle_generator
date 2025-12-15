export interface Cue {
  start: string;
  end: string;
  en: string;
  zh: string;
}

export interface JobResult {
  srtUrl: string;
  softVideoUrl: string;
  burnVideoUrl: string;
  previewCues: Cue[];
}

export interface JobStatus {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  stage: 'upload' | 'transcribe' | 'translate' | 'srt' | 'render_soft' | 'render_burn' | 'complete';
  progress: number;
  message?: string;
  error?: string;
  result?: JobResult;
}

export interface UploadResponse {
  jobId: string;
}
