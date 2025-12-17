import React, { useState, useRef, useEffect } from 'react';
import { Cue } from '../types';
import { Play, Pause, Save, RotateCw, Check } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../constants';

interface SubtitleEditorProps {
  jobId: string;
  initialCues: Cue[];
  videoUrl: string;
  onContinue: () => void;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({ jobId, initialCues, videoUrl, onContinue }) => {
  const [cues, setCues] = useState<Cue[]>(initialCues);
  const [activeCueIndex, setActiveCueIndex] = useState<number>(-1);
  const [isSaving, setIsSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Parse timestamp string "00:00:01,000" to seconds
  const parseTime = (timeStr: string) => {
    const [h, m, sWithMs] = timeStr.split(':');
    const [s, ms] = sWithMs.split(',');
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
  };

  // Update active cue based on video time
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const currentTime = videoRef.current.currentTime;
    
    // Find cue that contains current time
    const index = cues.findIndex(c => {
      const start = parseTime(c.start);
      const end = parseTime(c.end);
      return currentTime >= start && currentTime <= end;
    });
    
    if (index !== -1) setActiveCueIndex(index);
  };

  const handleCueClick = (index: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = parseTime(cues[index].start);
      videoRef.current.play();
    }
    setActiveCueIndex(index);
  };

  const updateCue = (index: number, field: keyof Cue, value: string) => {
    const newCues = [...cues];
    newCues[index] = { ...newCues[index], [field]: value };
    setCues(newCues);
  };

  const handleSaveAndContinue = async () => {
    setIsSaving(true);
    try {
      // 1. Save Edits
      await axios.post(`${API_BASE}/job/${jobId}/update`, { cues });
      // 2. Resume Job
      await axios.post(`${API_BASE}/job/${jobId}/resume`);
      onContinue();
    } catch (err) {
      console.error("Failed to save/resume", err);
      alert("Failed to save changes. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // Scroll active cue into view
  const cueRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (activeCueIndex !== -1 && cueRefs.current[activeCueIndex]) {
      cueRefs.current[activeCueIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeCueIndex]);

  return (
    <div className="mt-6 animate-in fade-in zoom-in duration-300">
      <div className="bg-white rounded-xl shadow-xl overflow-hidden border border-slate-200">
        <div className="bg-slate-900 p-4 flex justify-between items-center text-white">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="bg-blue-600 text-xs px-2 py-1 rounded">Review</span>
            Edit Subtitles
          </h2>
          <button 
            onClick={handleSaveAndContinue}
            disabled={isSaving}
            className="flex items-center space-x-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isSaving ? <RotateCw className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
            <span>Approve & Render</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 h-[600px]">
          {/* Video Player Column */}
          <div className="lg:col-span-2 bg-black flex items-center justify-center relative">
            <video 
              ref={videoRef}
              src={`http://localhost:3001${videoUrl}`} 
              controls 
              className="max-h-full w-full"
              onTimeUpdate={handleTimeUpdate}
            />
          </div>

          {/* Subtitle List Column */}
          <div className="bg-slate-50 overflow-y-auto border-l border-slate-200 p-4 space-y-4">
             {cues.map((cue, idx) => (
               <div 
                key={idx}
                ref={el => { cueRefs.current[idx] = el; }}
                onClick={() => handleCueClick(idx)}
                className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${
                  activeCueIndex === idx 
                    ? 'border-blue-500 bg-white shadow-md scale-[1.02]' 
                    : 'border-transparent bg-white hover:border-slate-300'
                }`}
               >
                 {/* Timestamps */}
                 <div className="flex gap-2 mb-2">
                   <input 
                     type="text" 
                     value={cue.start}
                     onChange={(e) => updateCue(idx, 'start', e.target.value)}
                     className="w-24 text-xs font-mono bg-slate-100 border border-slate-300 rounded px-1 py-0.5 text-center focus:ring-1 focus:ring-blue-500 outline-none"
                   />
                   <span className="text-slate-400 text-xs flex items-center">→</span>
                   <input 
                     type="text" 
                     value={cue.end}
                     onChange={(e) => updateCue(idx, 'end', e.target.value)}
                     className="w-24 text-xs font-mono bg-slate-100 border border-slate-300 rounded px-1 py-0.5 text-center focus:ring-1 focus:ring-blue-500 outline-none"
                   />
                 </div>

                 {/* Text Inputs */}
                 <div className="space-y-2">
                   <textarea
                     value={cue.en}
                     onChange={(e) => updateCue(idx, 'en', e.target.value)}
                     rows={2}
                     className="w-full text-sm p-2 border border-slate-200 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none font-medium text-slate-700"
                     placeholder="English text..."
                   />
                   <textarea
                     value={cue.zh}
                     onChange={(e) => updateCue(idx, 'zh', e.target.value)}
                     rows={2}
                     className="w-full text-sm p-2 border border-slate-200 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none text-slate-600"
                     placeholder="Chinese text..."
                   />
                 </div>
               </div>
             ))}
          </div>
        </div>
      </div>
      <p className="text-center text-slate-400 text-sm mt-4">
        Click a subtitle card to jump to that timestamp in the video.
      </p>
    </div>
  );
};