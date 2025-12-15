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

// Simulated subtitles for demo purposes
// In a real app, this would be the output of Whisper + Translation API
export const SIMULATED_TRANSCRIPT = [
  { start: 1, end: 3, en: "Welcome to this specialized video tutorial.", zh: "欢迎观看这个专门的视频教程。" },
  { start: 3.5, end: 6, en: "Today we will learn how to build a subtitle generator.", zh: "今天我们将学习如何构建一个字幕生成器。" },
  { start: 6.5, end: 9, en: "It involves React, Node.js, and FFmpeg processing.", zh: "它涉及 React、Node.js 和 FFmpeg 处理。" },
  { start: 9.5, end: 12, en: "The subtitles you see here are exactly two lines.", zh: "您在这里看到的字幕正好是两行。" },
  { start: 12.5, end: 15, en: "English is on the top, and Chinese is below.", zh: "英语在上面，中文在下面。" },
  { start: 15.5, end: 18, en: "Soft subtitles can be toggled on or off.", zh: "软字幕可以开启或关闭。" },
  { start: 18.5, end: 21, en: "Hard subtitles are permanently burned into the video.", zh: "硬字幕永久烧录在视频中。" },
  { start: 22, end: 25, en: "Thank you for using our bilingual tool.", zh: "感谢使用我们的双语工具。" },
];
