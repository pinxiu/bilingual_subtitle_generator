import React from 'react';
import { JobResult, OutputFormat } from '../types';
import { FileDown, Film, Subtitles } from 'lucide-react';

interface DownloadSectionProps {
  result: JobResult;
}

const getFullUrl = (path?: string) => {
  if (!path) return '#';
  if (path.startsWith('http')) return path;
  return `http://localhost:3001${path}`;
};

export const DownloadSection: React.FC<DownloadSectionProps> = ({ result }) => {
  const mode: OutputFormat | 'bilingual' =
    result.renderedSubtitleMode || 'bilingual';

  const srtLabel =
    mode === 'en'
      ? 'English .srt file'
      : mode === 'zh'
      ? 'Chinese .srt file'
      : 'Bilingual .srt file';

  return (
    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
      <a 
        href={getFullUrl(result.srtUrl)} 
        target="_blank" 
        download
        className="flex items-center justify-center space-x-2 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 transition-all shadow-sm group"
      >
        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg group-hover:bg-purple-200 dark:group-hover:bg-purple-900/50 transition-colors">
          <Subtitles className="w-6 h-6 text-purple-600 dark:text-purple-400" />
        </div>
        <div className="text-left">
          <div className="font-semibold text-slate-800 dark:text-slate-200">Download SRT</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{srtLabel}</div>
        </div>
      </a>

      {result.softVideoUrl && (
        <a 
          href={getFullUrl(result.softVideoUrl)} 
          target="_blank" 
          download
          className="flex items-center justify-center space-x-2 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 transition-all shadow-sm group"
        >
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
            <FileDown className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800 dark:text-slate-200">Soft Subtitles</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Video with switchable subs</div>
          </div>
        </a>
      )}

      {result.burnVideoUrl && (
        <a 
          href={getFullUrl(result.burnVideoUrl)} 
          target="_blank" 
          download
          className="flex items-center justify-center space-x-2 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 transition-all shadow-sm group"
        >
          <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg group-hover:bg-orange-200 dark:group-hover:bg-orange-900/50 transition-colors">
            <Film className="w-6 h-6 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800 dark:text-slate-200">Hard Subtitles</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Burned into video</div>
          </div>
        </a>
      )}
    </div>
  );
};
