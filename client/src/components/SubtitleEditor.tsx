
import React, { useState, useRef, useEffect } from 'react';
import { Cue, RenderConfig } from '../types';
import { Play, Pause, Save, RotateCw, Check, Trash2, Merge, Clock, Undo2, Scissors, MapPin, Settings, X, Plus, PlusCircle, Link2, Unlink2 } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../constants';

interface SubtitleEditorProps {
  jobId: string;
  initialCues: Cue[];
  videoUrl: string;
  onContinue: (config: RenderConfig) => void;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({ jobId, initialCues, videoUrl, onContinue }) => {
  const [cues, setCues] = useState<Cue[]>(initialCues);
  const [history, setHistory] = useState<Cue[][]>([]);
  const [activeCueIndex, setActiveCueIndex] = useState<number>(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  // Preference: Auto-link adjacent segments
  const [autoLinkSegments, setAutoLinkSegments] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Render Config Modal
  const [showRenderModal, setShowRenderModal] = useState(false);
  const [renderConfig, setRenderConfig] = useState<RenderConfig>({
    renderSoft: true,
    renderBurn: true,
    burnConfig: {
      fontSize: 24, // Increased default for visibility
      fontName: 'Arial',
      primaryColour: '&H00FFFFFF', // White
      outlineColour: '&H80000000', // Black transparent
      backColour: '&H80000000',
      bold: false,
      borderStyle: 1, // Outline
      outline: 2,
      shadow: 0,
      marginV: 30,
      lineHeight: 1.2
    }
  });

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
    
    // Sticky selection
    if (activeCueIndex !== -1 && cues[activeCueIndex]) {
        const currentCue = cues[activeCueIndex];
        const start = parseTime(currentCue.start);
        const end = parseTime(currentCue.end);
        if (currentTime >= start && currentTime <= end) {
            return;
        }
    }
    
    const index = cues.findIndex(c => {
      const start = parseTime(c.start);
      const end = parseTime(c.end);
      return currentTime >= start && currentTime <= end;
    });
    
    if (index !== activeCueIndex) {
        setActiveCueIndex(index);
    }
  };

  const handleCueClick = (index: number) => {
    if (videoRef.current) {
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
      zh: (previous.zh + current.zh).trim()
    };

    const newCues = [...cues];
    newCues.splice(index - 1, 2, newCue);
    setCues(newCues);
  };

  const handleSplitCue = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;

    const currentTime = videoRef.current.currentTime;
    const cue = cues[index];
    const start = parseTime(cue.start);
    const end = parseTime(cue.end);

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
    const newCues = [...cues];
    
    // Update current cue
    newCues[index] = { ...newCues[index], [field]: timeStr };
    
    // Synchronize adjacent cue only if autoLinkSegments is true
    if (autoLinkSegments) {
        if (field === 'end' && index < newCues.length - 1) {
           newCues[index + 1] = { ...newCues[index + 1], start: timeStr };
        } else if (field === 'start' && index > 0) {
           newCues[index - 1] = { ...newCues[index - 1], end: timeStr };
        }
    }
    
    setCues(newCues);
  };

  const handleInsertCue = (index: number, position: 'start' | 'end' | 'after') => {
    addToHistory();
    const newCues = [...cues];
    let startSec = 0;
    let endSec = 2;

    if (position === 'start') {
        // Insert at very beginning
        startSec = 0;
        if (cues.length > 0) {
            const firstStart = parseTime(cues[0].start);
            endSec = Math.min(2, Math.max(0.5, firstStart - 0.1));
        } else {
            endSec = 2;
        }
    } else if (position === 'end') {
        // Insert at very end
        if (cues.length > 0) {
            startSec = parseTime(cues[cues.length - 1].end) + 0.1;
            endSec = startSec + 2;
        }
    } else if (position === 'after') {
        // Insert after specific index
        const currentEnd = parseTime(cues[index].end);
        startSec = currentEnd + 0.1;
        
        // Check next cue to see available gap
        if (index < cues.length - 1) {
            const nextStart = parseTime(cues[index + 1].start);
            const gap = nextStart - startSec;
            if (gap > 2) {
                endSec = startSec + 2;
            } else if (gap > 0.5) {
                endSec = nextStart - 0.1;
            } else {
                // Gap too small, default to 2s and let user overlap/fix
                endSec = startSec + 2;
            }
        } else {
            endSec = startSec + 2;
        }
    }

    const newCue: Cue = {
        start: formatTime(startSec),
        end: formatTime(endSec),
        en: "New Subtitle",
        zh: "新字幕"
    };

    if (position === 'start') {
        newCues.unshift(newCue);
    } else if (position === 'end') {
        newCues.push(newCue);
    } else if (position === 'after') {
        newCues.splice(index + 1, 0, newCue);
    }
    
    setCues(newCues);
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

  const handleFinishClick = () => {
      setShowRenderModal(true);
  };

  const confirmRender = async () => {
    setShowRenderModal(false);
    setIsSaving(true);
    try {
      // 1. Save Edits
      await axios.post(`${API_BASE}/job/${jobId}/update`, { cues });
      // 2. Continue with config
      onContinue(renderConfig);
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
    <div className="mt-6 animate-in fade-in zoom-in duration-300 relative">
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
              onClick={() => setAutoLinkSegments(!autoLinkSegments)}
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors border border-slate-700 ${autoLinkSegments ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              title={autoLinkSegments ? "Seamless Mode: Adjacent segments update automatically" : "Independent Mode: Segments update individually"}
            >
              {autoLinkSegments ? <Link2 className="w-4 h-4"/> : <Unlink2 className="w-4 h-4"/>}
              <span className="hidden sm:inline">{autoLinkSegments ? "Linked" : "Unlinked"}</span>
            </button>
            <div className="w-px bg-slate-700 mx-1"></div>
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
              onClick={handleFinishClick}
              disabled={isSaving}
              className="flex items-center space-x-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isSaving ? <RotateCw className="w-4 h-4 animate-spin"/> : <Settings className="w-4 h-4"/>}
              <span>Render</span>
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
            
            {/* Overlay Preview */}
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
          <div className="bg-slate-50 overflow-y-auto border-l border-slate-200 p-4">
             {/* Add Start Button */}
             <button 
                onClick={() => handleInsertCue(0, 'start')}
                className="w-full py-2 mb-4 flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-dashed border-slate-300 rounded-lg transition-colors"
             >
                <PlusCircle className="w-4 h-4" />
                Add Segment at Start
             </button>

             <div className="space-y-4">
             {cues.map((cue, idx) => (
               <React.Fragment key={idx}>
               <div 
                ref={el => { cueRefs.current[idx] = el; }}
                onClick={() => handleCueClick(idx)}
                className={`p-4 rounded-xl border-2 transition-all group cursor-pointer ${
                  activeCueIndex === idx 
                    ? 'border-blue-500 bg-white shadow-md ring-1 ring-blue-500' 
                    : 'border-transparent bg-white hover:border-slate-300 shadow-sm'
                }`}
               >
                 {/* Flex wrap added to prevent overflow */}
                 <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
                    <div className="flex gap-2 items-center shrink-0 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                      <button 
                        onClick={(e) => handleSetTime(idx, 'start', e)}
                        className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors"
                        title="Set start to current video time"
                      >
                         <MapPin className="w-3.5 h-3.5" />
                      </button>
                      <input 
                        type="text" 
                        value={cue.start}
                        onClick={(e) => e.stopPropagation()} 
                        onChange={(e) => updateCue(idx, 'start', e.target.value)}
                        className="w-24 text-xs font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                      />
                      <span className="text-slate-300 text-xs">→</span>
                      <input 
                        type="text" 
                        value={cue.end}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateCue(idx, 'end', e.target.value)}
                        className="w-24 text-xs font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                      />
                      <button 
                        onClick={(e) => handleSetTime(idx, 'end', e)}
                        className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors"
                        title="Set end to current video time"
                      >
                         <MapPin className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                          onClick={(e) => handleSplitCue(idx, e)}
                          className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors"
                          title="Split at current video time"
                        >
                          <Scissors className="w-4 h-4" />
                      </button>
                      {idx > 0 && (
                        <button 
                          onClick={(e) => handleMergePrevious(idx, e)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          title="Merge with previous"
                        >
                          <Merge className="w-4 h-4" />
                        </button>
                      )}
                      <button 
                        onClick={(e) => handleDeleteCue(idx, e)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                 </div>

                 <div className="space-y-3">
                   <div className="relative">
                     <textarea
                       value={cue.en}
                       onClick={(e) => e.stopPropagation()}
                       onChange={(e) => updateCue(idx, 'en', e.target.value)}
                       rows={2}
                       className="w-full text-sm p-3 pb-6 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none resize-none font-medium text-slate-800 placeholder-slate-400 transition-all"
                       placeholder="English text..."
                     />
                     <span className="absolute bottom-2 right-3 text-[10px] text-slate-400 font-mono">
                       {cue.en.length}
                     </span>
                   </div>
                   <div className="relative">
                     <textarea
                       value={cue.zh}
                       onClick={(e) => e.stopPropagation()}
                       onChange={(e) => updateCue(idx, 'zh', e.target.value)}
                       rows={2}
                       className="w-full text-sm p-3 pb-6 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none resize-none text-slate-600 placeholder-slate-400 transition-all"
                       placeholder="Chinese text..."
                     />
                     <span className="absolute bottom-2 right-3 text-[10px] text-slate-400 font-mono">
                       {cue.zh.length}
                     </span>
                   </div>
                 </div>
               </div>
               
               {/* Add Between Button - Visual divider that appears on hover */}
               <div className="h-4 -my-3 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10 relative group/add">
                   <div className="absolute inset-x-0 h-px bg-blue-200"></div>
                   <button 
                     onClick={(e) => { e.stopPropagation(); handleInsertCue(idx, 'after'); }}
                     className="relative bg-white text-blue-500 border border-blue-200 rounded-full p-1.5 shadow-sm hover:bg-blue-50 hover:scale-110 transition-transform"
                     title="Insert segment here"
                   >
                       <Plus className="w-4 h-4" />
                   </button>
               </div>
               </React.Fragment>
             ))}
             </div>

             {/* Add End Button */}
             <button 
                onClick={() => handleInsertCue(cues.length - 1, 'end')}
                className="w-full py-2 mt-4 flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-dashed border-slate-300 rounded-lg transition-colors"
             >
                <PlusCircle className="w-4 h-4" />
                Add Segment at End
             </button>
          </div>
        </div>
      </div>
      
      {/* Render Config Modal */}
      {showRenderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
               <div className="bg-slate-900 p-4 text-white flex justify-between items-center shrink-0">
                   <h3 className="font-semibold text-lg">Render Settings</h3>
                   <button onClick={() => setShowRenderModal(false)} className="text-slate-400 hover:text-white">
                       <X className="w-5 h-5"/>
                   </button>
               </div>
               
               <div className="p-6 space-y-6 overflow-y-auto">
                   
                   {/* Preview Box */}
                   {renderConfig.renderBurn && (
                       <div className="space-y-2">
                           <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Burn Preview</label>
                           <div className="bg-slate-800 rounded-lg overflow-hidden relative aspect-video flex justify-center w-full border border-slate-700 shadow-inner group">
                                <div className="absolute inset-0 opacity-20 bg-[url('https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80')] bg-cover bg-center grayscale group-hover:grayscale-0 transition-all duration-700"></div>
                                
                                <div 
                                    className="absolute w-full text-center flex flex-col items-center pointer-events-none transition-all duration-200"
                                    style={{ 
                                        bottom: `${renderConfig.burnConfig.marginV}px`,
                                    }}
                                >
                                    <div 
                                        style={{
                                            fontSize: `${renderConfig.burnConfig.fontSize}px`,
                                            fontFamily: renderConfig.burnConfig.fontName,
                                            lineHeight: renderConfig.burnConfig.lineHeight,
                                            fontWeight: renderConfig.burnConfig.bold ? 'bold' : 'normal',
                                            color: 'white',
                                            ...(renderConfig.burnConfig.borderStyle === 1 
                                                ? { 
                                                    textShadow: `
                                                        -${renderConfig.burnConfig.outline}px -${renderConfig.burnConfig.outline}px 0 #000,  
                                                         ${renderConfig.burnConfig.outline}px -${renderConfig.burnConfig.outline}px 0 #000,
                                                        -${renderConfig.burnConfig.outline}px  ${renderConfig.burnConfig.outline}px 0 #000,
                                                         ${renderConfig.burnConfig.outline}px  ${renderConfig.burnConfig.outline}px 0 #000,
                                                         0px 2px 4px rgba(0,0,0,0.5)
                                                    `
                                                  } 
                                                : { 
                                                    backgroundColor: 'rgba(0,0,0,0.6)', 
                                                    padding: '4px 12px',
                                                    borderRadius: '4px',
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                                  }
                                            )
                                        }}
                                    >
                                        <div>This is a sample subtitle</div>
                                        <div>这是一行示例字幕</div>
                                    </div>
                                </div>
                           </div>
                       </div>
                   )}

                   {/* Outputs */}
                   <div className="space-y-3">
                       <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Output Files</label>
                       <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
                           <input 
                             type="checkbox" 
                             checked={renderConfig.renderSoft}
                             onChange={e => setRenderConfig(prev => ({ ...prev, renderSoft: e.target.checked }))}
                             className="w-5 h-5 text-blue-600 rounded" 
                           />
                           <div>
                               <div className="font-medium text-slate-800">Soft Subtitles (Muxed)</div>
                               <div className="text-xs text-slate-500">Embedded subtitles, switchable on/off</div>
                           </div>
                       </label>
                       <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
                           <input 
                             type="checkbox" 
                             checked={renderConfig.renderBurn}
                             onChange={e => setRenderConfig(prev => ({ ...prev, renderBurn: e.target.checked }))}
                             className="w-5 h-5 text-blue-600 rounded" 
                           />
                           <div>
                               <div className="font-medium text-slate-800">Hard Subtitles (Burned)</div>
                               <div className="text-xs text-slate-500">Permanently drawn onto video</div>
                           </div>
                       </label>
                   </div>

                   {/* Burn Settings */}
                   {renderConfig.renderBurn && (
                       <div className="space-y-4 animate-in slide-in-from-top-2">
                           <div className="h-px bg-slate-200"></div>
                           <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Burn Appearance</label>
                           
                           <div className="grid grid-cols-3 gap-4">
                               <div>
                                   <label className="block text-xs font-medium text-slate-600 mb-1">Font Size</label>
                                   <input 
                                     type="number" 
                                     value={renderConfig.burnConfig.fontSize}
                                     onChange={e => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, fontSize: parseInt(e.target.value) || 0}}))}
                                     className="w-full p-2 border rounded"
                                   />
                               </div>
                               <div>
                                   <label className="block text-xs font-medium text-slate-600 mb-1">Line Height</label>
                                   <input 
                                     type="number"
                                     step="0.1"
                                     value={renderConfig.burnConfig.lineHeight}
                                     onChange={e => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, lineHeight: parseFloat(e.target.value) || 0}}))}
                                     className="w-full p-2 border rounded"
                                   />
                               </div>
                               <div>
                                   <label className="block text-xs font-medium text-slate-600 mb-1">Vertical Margin</label>
                                   <input 
                                     type="number" 
                                     value={renderConfig.burnConfig.marginV}
                                     onChange={e => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, marginV: parseInt(e.target.value) || 0}}))}
                                     className="w-full p-2 border rounded"
                                   />
                               </div>
                           </div>

                           <div>
                               <label className="block text-xs font-medium text-slate-600 mb-1">Background Style</label>
                               <div className="grid grid-cols-2 gap-2">
                                   <button 
                                     onClick={() => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, borderStyle: 1}}))}
                                     className={`p-2 text-sm rounded border transition-colors ${renderConfig.burnConfig.borderStyle === 1 ? 'bg-blue-50 border-blue-500 text-blue-700 font-medium' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                                   >
                                       Outline (Text Shadow)
                                   </button>
                                   <button 
                                     onClick={() => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, borderStyle: 3}}))}
                                     className={`p-2 text-sm rounded border transition-colors ${renderConfig.burnConfig.borderStyle === 3 ? 'bg-blue-50 border-blue-500 text-blue-700 font-medium' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                                   >
                                       Opaque Box
                                   </button>
                               </div>
                           </div>
                       </div>
                   )}

                   <div className="pt-2">
                       <button 
                         onClick={confirmRender}
                         className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-lg flex justify-center items-center gap-2"
                       >
                           <RotateCw className="w-5 h-5" />
                           Start Rendering
                       </button>
                   </div>
               </div>
           </div>
        </div>
      )}
    </div>
  );
};
