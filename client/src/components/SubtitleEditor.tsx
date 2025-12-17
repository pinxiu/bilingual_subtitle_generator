import React, { useState, useRef, useEffect } from 'react';
import { Cue } from '../types';
import { Play, Pause, Save, RotateCw, Check, Trash2, Merge, Clock, Undo2, Scissors, MapPin } from 'lucide-react';
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
  const [history, setHistory] = useState<Cue[][]>([]);
  const [activeCueIndex, setActiveCueIndex] = useState<number>(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Parse timestamp string "00:00:01,000" to seconds
  const parseTime = (timeStr: string) => {
    const [h, m, sWithMs] = timeStr.split(':');
    const [s, ms] = sWithMs.split(',');
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
  };

  // Format seconds to timestamp string "00:00:01,000"
  const formatTime = (seconds: number) => {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const iso = date.toISOString();
    return iso.substring(11, 23).replace('.', ',');
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
    
    // Only update if changed to prevent re-renders
    if (index !== activeCueIndex) {
        setActiveCueIndex(index);
    }
  };

  const handleCueClick = (index: number) => {
    if (videoRef.current) {
      // Just jump to time. Do not force play.
      videoRef.current.currentTime = parseTime(cues[index].start);
    }
    setActiveCueIndex(index);
  };

  const updateCue = (index: number, field: keyof Cue, value: string) => {
    const newCues = [...cues];
    newCues[index] = { ...newCues[index], [field]: value };
    setCues(newCues);
  };

  const addToHistory = () => {
    // Snapshot current state before mutation
    setHistory(prev => [...prev, cues]);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setCues(previous);
  };

  const handleDeleteCue = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    // Removed confirm dialog for smoother workflow since Undo is available
    addToHistory();
    const newCues = [...cues];
    newCues.splice(index, 1);
    setCues(newCues);
  };

  const handleMergePrevious = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index <= 0) return;

    addToHistory();

    const previous = cues[index - 1];
    const current = cues[index];

    const newCue: Cue = {
      start: previous.start,
      end: current.end,
      en: (previous.en + " " + current.en).trim(),
      zh: (previous.zh + current.zh).trim() // No space for Chinese text merging
    };

    const newCues = [...cues];
    newCues.splice(index - 1, 2, newCue); // Remove prev and current, insert merged
    setCues(newCues);
  };

  const handleSplitCue = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;

    const currentTime = videoRef.current.currentTime;
    const cue = cues[index];
    const start = parseTime(cue.start);
    const end = parseTime(cue.end);

    // Allow a small buffer
    if (currentTime <= start + 0.1 || currentTime >= end - 0.1) {
      alert("Video time must be within the subtitle segment to split.");
      return;
    }

    addToHistory();

    const splitPoint = formatTime(currentTime);
    
    const firstPart: Cue = { ...cue, end: splitPoint };
    const secondPart: Cue = { ...cue, start: splitPoint };

    const newCues = [...cues];
    newCues.splice(index, 1, firstPart, secondPart);
    setCues(newCues);
  };

  const handleSetTime = (index: number, field: 'start' | 'end', e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    
    addToHistory();
    const timeStr = formatTime(videoRef.current.currentTime);
    updateCue(index, field, timeStr);
  };

  const saveProgress = async () => {
    setIsSaving(true);
    try {
       await axios.post(`${API_BASE}/job/${jobId}/update`, { cues });
       setLastSaved(new Date());
    } catch (err) {
      console.error("Failed to save progress", err);
      alert("Failed to save progress.");
    } finally {
      setIsSaving(false);
    }
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
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="bg-blue-600 text-xs px-2 py-1 rounded">Editor</span>
              Subtitle Review
            </h2>
            {lastSaved && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                Saved {lastSaved.toLocaleTimeString()}
              </span>
            )}
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={handleUndo}
              disabled={history.length === 0}
              className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Undo Last Action"
            >
              <Undo2 className="w-4 h-4"/>
              <span className="hidden sm:inline">Undo</span>
            </button>
            <div className="w-px bg-slate-700 mx-1"></div>
            <button 
              onClick={saveProgress}
              disabled={isSaving}
              className="flex items-center space-x-2 bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              title="Save Draft"
            >
              <Save className="w-4 h-4"/>
              <span className="hidden sm:inline">Save Draft</span>
            </button>
            <button 
              onClick={handleSaveAndContinue}
              disabled={isSaving}
              className="flex items-center space-x-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isSaving ? <RotateCw className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
              <span>Render Video</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 h-[650px]">
          {/* Video Player Column */}
          <div className="lg:col-span-2 bg-black flex items-center justify-center relative group">
            <video 
              ref={videoRef}
              src={`http://localhost:3001${videoUrl}`} 
              controls 
              className="max-h-full w-full"
              onTimeUpdate={handleTimeUpdate}
            />
            
            {/* Subtitle Overlay */}
            {activeCueIndex !== -1 && cues[activeCueIndex] && (
              <div className="absolute bottom-12 left-0 right-0 px-8 text-center pointer-events-none">
                 <div className="inline-block bg-black/70 backdrop-blur-sm p-3 rounded-xl">
                   <p className="text-white text-lg sm:text-xl font-medium drop-shadow-md leading-relaxed">
                     {cues[activeCueIndex].en}
                   </p>
                   <p className="text-yellow-400 text-lg sm:text-xl font-medium drop-shadow-md leading-relaxed mt-1">
                     {cues[activeCueIndex].zh}
                   </p>
                 </div>
              </div>
            )}
          </div>

          {/* Subtitle List Column */}
          <div className="bg-slate-50 overflow-y-auto border-l border-slate-200 p-4 space-y-4">
             {cues.map((cue, idx) => (
               <div 
                key={idx}
                ref={el => { cueRefs.current[idx] = el; }}
                onClick={() => handleCueClick(idx)}
                className={`p-3 rounded-lg border-2 transition-all group ${
                  activeCueIndex === idx 
                    ? 'border-blue-500 bg-white shadow-md' 
                    : 'border-transparent bg-white hover:border-slate-300'
                }`}
               >
                 {/* Top Row: Timestamps and Toolbar */}
                 <div className="flex justify-between items-center mb-2">
                    <div className="flex gap-1 items-center">
                      <button 
                        onClick={(e) => handleSetTime(idx, 'start', e)}
                        className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50"
                        title="Set start to current video time"
                      >
                         <MapPin className="w-3 h-3" />
                      </button>
                      <input 
                        type="text" 
                        value={cue.start}
                        onClick={(e) => e.stopPropagation()} 
                        onChange={(e) => updateCue(idx, 'start', e.target.value)}
                        className="w-24 text-xs font-mono bg-slate-100 border border-slate-300 rounded px-1 py-0.5 text-center focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                      <span className="text-slate-400 text-xs">→</span>
                      <input 
                        type="text" 
                        value={cue.end}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateCue(idx, 'end', e.target.value)}
                        className="w-24 text-xs font-mono bg-slate-100 border border-slate-300 rounded px-1 py-0.5 text-center focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                      <button 
                        onClick={(e) => handleSetTime(idx, 'end', e)}
                        className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50"
                        title="Set end to current video time"
                      >
                         <MapPin className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Action Buttons (Visible on Hover/Active) */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                          onClick={(e) => handleSplitCue(idx, e)}
                          className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded bg-white shadow-sm border border-slate-200"
                          title="Split at current video time"
                        >
                          <Scissors className="w-3 h-3" />
                      </button>

                      {idx > 0 && (
                        <button 
                          onClick={(e) => handleMergePrevious(idx, e)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded bg-white shadow-sm border border-slate-200"
                          title="Merge with previous"
                        >
                          <Merge className="w-3 h-3" />
                        </button>
                      )}
                      <button 
                        onClick={(e) => handleDeleteCue(idx, e)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded bg-white shadow-sm border border-slate-200"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                 </div>

                 {/* Text Inputs with Char Count */}
                 <div className="space-y-2">
                   <div className="relative">
                     <textarea
                       value={cue.en}
                       onClick={(e) => e.stopPropagation()}
                       onChange={(e) => updateCue(idx, 'en', e.target.value)}
                       rows={2}
                       className="w-full text-sm p-2 pb-6 border border-slate-200 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none font-medium text-slate-700 block"
                       placeholder="English text..."
                     />
                     <span className="absolute bottom-1.5 right-2 text-[10px] text-slate-400 bg-slate-50 px-1 rounded">
                       {cue.en.length}
                     </span>
                   </div>
                   
                   <div className="relative">
                     <textarea
                       value={cue.zh}
                       onClick={(e) => e.stopPropagation()}
                       onChange={(e) => updateCue(idx, 'zh', e.target.value)}
                       rows={2}
                       className="w-full text-sm p-2 pb-6 border border-slate-200 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none text-slate-600 block"
                       placeholder="Chinese text..."
                     />
                     <span className="absolute bottom-1.5 right-2 text-[10px] text-slate-400 bg-slate-50 px-1 rounded">
                       {cue.zh.length}
                     </span>
                   </div>
                 </div>
               </div>
             ))}
          </div>
        </div>
      </div>
      <p className="text-center text-slate-400 text-sm mt-4">
        Click a card to jump to time. Use <Save className="w-3 h-3 inline"/> to save draft. Use <Merge className="w-3 h-3 inline"/> to merge with previous.
      </p>
    </div>
  );
};