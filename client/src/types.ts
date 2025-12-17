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
  rawVideoUrl?: string;
  previewCues: Cue[];
}

export interface JobStatus {
  id: string;
  status: 'queued' | 'processing' | 'waiting_for_approval' | 'done' | 'error';
  stage: 'upload' | 'transcribe' | 'translate' | 'srt' | 'user_review' | 'render_soft' | 'render_burn' | 'complete';
  progress: number;
  message?: string;
  error?: string;
  result?: JobResult;
}

export interface UploadResponse {
  jobId: string;
}