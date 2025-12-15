import React from 'react';
import { JobResult } from '../types';
import { FileDown, Film, Subtitles } from 'lucide-react';

interface DownloadSectionProps {
  result: JobResult;
}

const getFullUrl = (path: string) => {
  if (path.startsWith('http')) return path;
  return `http://localhost:3001${path}`;
};

export const DownloadSection: React.FC<DownloadSectionProps> = ({ result }) => {
  return (
    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
      <a 
        href={getFullUrl(result.srtUrl)} 
        target="_blank" 
        download
        className="flex items-center justify-center space-x-2 p-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm group"
      >
        <div className="p-2 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
          <Subtitles className="w-6 h-6 text-purple-600" />
        </div>
        <div className="text-left">
          <div className="font-semibold text-slate-800">Download SRT</div>
          <div className="text-xs text-slate-500">Bilingual .srt file</div>
        </div>
      </a>

      <a 
        href={getFullUrl(result.softVideoUrl)} 
        target="_blank" 
        download
        className="flex items-center justify-center space-x-2 p-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm group"
      >
        <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
          <FileDown className="w-6 h-6 text-blue-600" />
        </div>
        <div className="text-left">
          <div className="font-semibold text-slate-800">Soft Subtitles</div>
          <div className="text-xs text-slate-500">Video with switchable subs</div>
        </div>
      </a>

      <a 
        href={getFullUrl(result.burnVideoUrl)} 
        target="_blank" 
        download
        className="flex items-center justify-center space-x-2 p-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm group"
      >
        <div className="p-2 bg-orange-100 rounded-lg group-hover:bg-orange-200 transition-colors">
          <Film className="w-6 h-6 text-orange-600" />
        </div>
        <div className="text-left">
          <div className="font-semibold text-slate-800">Hard Subtitles</div>
          <div className="text-xs text-slate-500">Burned into video</div>
        </div>
      </a>
    </div>
  );
};