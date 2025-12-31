import { Cue } from './types.js';

// Convert seconds to SRT timestamp format: 00:00:00,000
export function formatSrtTime(seconds: number): string {
  const date = new Date(0);
  date.setMilliseconds(seconds * 1000);
  const iso = date.toISOString();
  // ISO is YYYY-MM-DDTHH:mm:ss.sssZ
  // We need HH:mm:ss,sss
  const timePart = iso.substring(11, 23);
  return timePart.replace('.', ',');
}

// Parse a standard SRT file into Cue objects for the frontend preview
export function parseSrt(srtContent: string): Cue[] {
  const cues: Cue[] = [];
  // Normalize line endings to \n and trim whitespace
  const normalized = srtContent.replace(/\r\n/g, '\n').trim();
  // Split by double newlines to separate blocks
  const blocks = normalized.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim());
    if (lines.length < 2) continue; // Need at least Index and Time

    // Line 0: Index (ignored)
    // Line 1: Timestamp "00:00:01,000 --> 00:00:03,000"
    // Line 2: English / Primary Text
    // Line 3: Chinese / Secondary Text (optional)

    const timeLine = lines[1];
    if (!timeLine.includes('-->')) continue;
    
    const [start, end] = timeLine.split(' --> ');

    let en = lines[2] || "";
    // If line 3 exists, use it. If not, it's a standard SRT, so leave zh empty.
    let zh = lines[3] || ""; 

    // Heuristic: If we have a 3-line block (implying monolingual SRT)
    // and the text contains Chinese characters, assume it's Chinese.
    if (!zh && /[\u4e00-\u9fa5]/.test(en)) {
        zh = en;
        en = '';
    }

    if (start && end) {
      cues.push({ start, end, en, zh });
    }
  }
  return cues;
}

// Rebuild SRT content from Cue objects (for saving edits)
export function buildSrt(cues: Cue[]): string {
  return cues.map((cue, index) => {
    let textPart = '';
    if (cue.en && cue.zh) {
      textPart = `${cue.en}\n${cue.zh}`;
    } else if (cue.en) {
      textPart = cue.en;
    } else if (cue.zh) {
      textPart = cue.zh;
    }
    return `${index + 1}\n${cue.start} --> ${cue.end}\n${textPart}`;
  }).join('\n\n');
}