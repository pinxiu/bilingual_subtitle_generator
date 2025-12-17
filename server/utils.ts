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
  // Split by double newlines, handling CRLF
  const blocks = srtContent.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim());
    if (lines.length < 3) continue;

    // Line 0: Index (ignored)
    // Line 1: Timestamp "00:00:01,000 --> 00:00:03,000"
    // Line 2: English
    // Line 3: Chinese (optional, but expected in our format)

    const timeLine = lines[1];
    const [start, end] = timeLine.split(' --> ');

    const en = lines[2] || "";
    const zh = lines[3] || ""; // In our 2-line strict format, line 4 is Chinese

    if (start && end) {
      cues.push({ start, end, en, zh });
    }
  }
  return cues;
}

// Rebuild SRT content from Cue objects (for saving edits)
export function buildSrt(cues: Cue[]): string {
  return cues.map((cue, index) => {
    return `${index + 1}\n${cue.start} --> ${cue.end}\n${cue.en}\n${cue.zh}`;
  }).join('\n\n');
}