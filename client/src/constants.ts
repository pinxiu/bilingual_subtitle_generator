export const API_BASE = 'http://localhost:3001/api';

export const STAGE_LABELS: Record<string, string> = {
  upload: 'Uploading Video',
  transcribe: 'Transcribing Audio',
  translate: 'Translating Text',
  srt: 'Building SRT File',
  user_review: 'Waiting for Approval',
  render_soft: 'Muxing Soft Subtitles',
  render_burn: 'Burning Hard Subtitles',
  complete: 'Process Complete'
};