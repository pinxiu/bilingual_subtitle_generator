
export interface Cue {
  start: string;
  end: string;
  en: string;
  zh: string;
}

export type SourceLanguage = 'en' | 'zh';
export type OutputFormat = 'en' | 'zh' | 'bilingual';

export interface RenderConfig {
  renderSoft: boolean;
  renderBurn: boolean;
  // Which language(s) should be rendered into the final SRT / video
  // 'bilingual' = EN + ZH, 'en' = EN only, 'zh' = ZH only
  subtitleMode?: OutputFormat;
  burnConfig: {
    fontSize: number;
    fontName: string;
    primaryColour: string;
    outlineColour: string;
    backColour: string;
    bold: boolean;
    borderStyle: number;
    outline: number;
    shadow: number;
    marginV: number;
    lineHeight: number;
  };
}

export interface JobResult {
  srtUrl: string;
  softVideoUrl?: string;
  burnVideoUrl?: string;
  rawVideoUrl?: string;
  // Cues used in the editor (always bilingual so you can switch languages later)
  previewCues: Cue[];
  // Cues that reflect the last rendered output (filtered EN / ZH / bilingual)
  renderedPreviewCues?: Cue[];
   // Language mode that was rendered ('en' | 'zh' | 'bilingual')
  renderedSubtitleMode?: OutputFormat;
}

export interface JobStatus {
  id: string;
  status: 'queued' | 'processing' | 'waiting_for_approval' | 'done' | 'error';
  stage: 'upload' | 'transcribe' | 'translate' | 'srt' | 'user_review' | 'render_soft' | 'render_burn' | 'complete';
  progress: number;
  message?: string;
  error?: string;
  result?: JobResult;
  originalFilename?: string;
  // Config fields
  sourceLang?: SourceLanguage;
  outputFormat?: OutputFormat;
  lineCount?: number;
}

export interface UploadResponse {
  jobId: string;
}

export interface SavedJob {
  id: string;
  originalFilename: string;
  createdAt: number;
  lastModified: number;
}
