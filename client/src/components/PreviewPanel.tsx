import React from 'react';
import { Cue } from '../types';

interface PreviewPanelProps {
  cues: Cue[];
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ cues }) => {
  if (!cues || cues.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold text-slate-800 mb-4">Subtitle Preview</h3>
      <div className="bg-slate-900 rounded-lg p-4 overflow-y-auto max-h-80 shadow-inner">
        <div className="space-y-4">
          {cues.map((cue, idx) => (
            <div key={idx} className="bg-slate-800/50 p-3 rounded border border-slate-700">
              <div className="text-xs text-slate-500 font-mono mb-2">
                {cue.start} {'-->'} {cue.end}
              </div>
              <div className="text-white font-medium text-lg leading-snug">{cue.en}</div>
              <div className="text-yellow-400 font-medium text-lg leading-snug">{cue.zh}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};