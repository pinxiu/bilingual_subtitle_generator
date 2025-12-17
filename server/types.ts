
export type JobStatus = 'queued' | 'processing' | 'waiting_for_approval' | 'done' | 'error';

export type JobStage = 
  | 'upload' 
  | 'transcribe' 
  | 'translate' 
  | 'srt' 
  | 'user_review'
  | 'render_soft' 
  | 'render_burn' 
  | 'complete';

export interface Cue {
  start: string; // "00:00:01,000"
  end: string;   // "00:00:03,000"
  en: string;
  zh: string;
}

export interface RenderConfig {
  renderSoft: boolean;
  renderBurn: boolean;
  burnConfig?: {
    fontSize: number;
    fontName: string;
    primaryColour: string; // Hex AABBGGRR in ASS, but we might take web hex and convert
    outlineColour: string;
    backColour: string;
    bold: boolean;
    borderStyle: number; // 1=Outline, 3=Opaque Box
    outline: number;
    shadow: number;
    marginV: number;
    lineHeight: number;
  };
}

export interface JobResult {
  srtUrl?: string;
  softVideoUrl?: string;
  burnVideoUrl?: string;
  rawVideoUrl?: string;
  previewCues?: Cue[];
}

export interface Job {
  id: string;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  message?: string;
  error?: string;
  originalFilename?: string;
  filePath?: string;
  createdAt: number;
  result?: JobResult;
  renderConfig?: RenderConfig;
}
