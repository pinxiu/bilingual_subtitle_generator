
import React, { useState, useRef, useEffect } from 'react';
import { Cue, RenderConfig } from '../types';
import { Play, Pause, Save, RotateCw, Check, Trash2, Merge, Clock, Undo2, Scissors, MapPin, Settings, X, Plus, PlusCircle, Link2, Unlink2, Download, Languages, ChevronLeft, FileVideo, Volume2, VolumeX } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../constants';
// @ts-ignore - opencc-js doesn't have TypeScript definitions
import { Converter } from 'opencc-js';

interface SubtitleEditorProps {
  jobId: string;
  originalFilename: string;
  initialCues: Cue[];
  videoUrl: string;
  onContinue: (config: RenderConfig) => void;
  onBack: () => void;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({ jobId, originalFilename, initialCues, videoUrl, onContinue, onBack }) => {
  const [cues, setCues] = useState<Cue[]>(initialCues);
  const [history, setHistory] = useState<Cue[][]>([]);
  const [activeCueIndex, setActiveCueIndex] = useState<number>(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // Preference: Auto-link adjacent segments
  const [autoLinkSegments, setAutoLinkSegments] = useState(true);

  // UI: Which language(s) to show while reviewing
  // 'bilingual' = EN on top, ZH below (default)
  // 'en'        = English only
  // 'zh'        = Chinese only
  const [displayMode, setDisplayMode] = useState<'bilingual' | 'en' | 'zh'>('bilingual');

  const handleDisplayModeChange = (mode: 'bilingual' | 'en' | 'zh') => {
    setDisplayMode(mode);
    setHasUnsavedChanges(true);
  };

  // Chinese variant: 'simplified' or 'traditional'
  const [chineseVariant, setChineseVariant] = useState<'simplified' | 'traditional'>('simplified');

  // Video Controls State
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  
  // Initialize OpenCC converters (lazy-loaded)
  const [converters, setConverters] = useState<{
    s2t: ((text: string) => string) | null;
    t2s: ((text: string) => string) | null;
  }>({ s2t: null, t2s: null });

  // Initialize converters on mount
  useEffect(() => {
    try {
      // opencc-js uses 'cn' for Simplified and 'tw' for Traditional
      const s2t = Converter({ from: 'cn', to: 'tw' });
      const t2s = Converter({ from: 'tw', to: 'cn' });
      setConverters({ s2t, t2s });
    } catch (error) {
      console.error('Failed to initialize OpenCC:', error);
    }
    
    // Load preferences from local storage
    const savedPrefs = localStorage.getItem('bilingual_subtitle_editor_prefs');
    if (savedPrefs) {
        try {
            const prefs = JSON.parse(savedPrefs);
            if (prefs.displayMode) {
                setDisplayMode(prefs.displayMode);
            }
            if (prefs.chineseVariant) {
                setChineseVariant(prefs.chineseVariant);
            }
        } catch(e) {
            console.error("Failed to parse saved preferences", e);
        }
    }
  }, []);
  
  // Render Config Modal
  const [showRenderModal, setShowRenderModal] = useState(false);
  const [renderConfig, setRenderConfig] = useState<RenderConfig>({
    renderSoft: true,
    renderBurn: true,
    burnConfig: {
      fontSize: 20, // Adjusted default
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

  const [previewScale, setPreviewScale] = useState(1);
  const previewBoost = 3.2; // Increased multiplier for even better legibility

  const updatePreviewScale = () => {
      if (videoRef.current && videoRef.current.videoHeight > 0) {
          const scale = videoRef.current.clientHeight / videoRef.current.videoHeight;
          setPreviewScale(scale);
      }
  };

  useEffect(() => {
      window.addEventListener('resize', updatePreviewScale);
      return () => window.removeEventListener('resize', updatePreviewScale);
  }, []);

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

  const formatDisplayTime = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      if (h > 0) {
          return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      }
      return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };
  
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const vol = parseFloat(e.target.value);
      setVolume(vol);
      if (videoRef.current) {
          videoRef.current.volume = vol;
          setIsMuted(vol === 0);
      }
  };

  const toggleMute = () => {
      if (videoRef.current) {
          const newMuted = !isMuted;
          setIsMuted(newMuted);
          videoRef.current.muted = newMuted;
          if (newMuted) {
              setVolume(0);
          } else {
              setVolume(1);
              videoRef.current.volume = 1;
          }
      }
  };

  const handlePlaybackRateChange = (rate: number) => {
      setPlaybackRate(rate);
      if (videoRef.current) {
          videoRef.current.playbackRate = rate;
      }
  };

  const cyclePlaybackRate = () => {
      const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
      const currentIndex = rates.indexOf(playbackRate);
      const nextIndex = (currentIndex + 1) % rates.length;
      handlePlaybackRateChange(rates[nextIndex]);
  };

  const handleVideoLoad = () => {
      if (videoRef.current) {
          const d = videoRef.current.duration;
          if (Number.isFinite(d)) {
              setDuration(d);
          }
          updatePreviewScale();
      }
  };

  // Update active cue based on video time
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const currentTime = videoRef.current.currentTime;
    setCurrentTime(currentTime);
    
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
    setHasUnsavedChanges(true);
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

  // Convert all Chinese text between Traditional and Simplified
  const handleChineseVariantChange = (newVariant: 'simplified' | 'traditional') => {
    if (newVariant === chineseVariant || !converters.s2t || !converters.t2s) return;
    
    addToHistory();
    
    const converter = newVariant === 'traditional' ? converters.s2t : converters.t2s;
    const newCues = cues.map(cue => ({
      ...cue,
      zh: cue.zh ? converter(cue.zh) : ''
    }));
    
    setCues(newCues);
    setChineseVariant(newVariant);
    setHasUnsavedChanges(true);
  };

  const handleDeleteCue = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    addToHistory();
    const newCues = [...cues];
    newCues.splice(index, 1);
    setCues(newCues);
    setHasUnsavedChanges(true);
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
    setHasUnsavedChanges(true);
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
    setHasUnsavedChanges(true);
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
    setHasUnsavedChanges(true);
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
    setHasUnsavedChanges(true);
  };

  const saveProgress = async () => {
    setIsSaving(true);
    try {
      // Persist UI preferences
      const prefs = { displayMode, chineseVariant };
      localStorage.setItem('bilingual_subtitle_editor_prefs', JSON.stringify(prefs));

      await axios.post(`${API_BASE}/job/${jobId}/update`, { cues });
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
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
    // Derive which language(s) should be rendered from the current display mode
    const subtitleMode =
      displayMode === 'en' ? 'en' :
      displayMode === 'zh' ? 'zh' : 'bilingual';

    setShowRenderModal(false);
    setIsSaving(true);
    try {
      // 1. Save Edits
      await axios.post(`${API_BASE}/job/${jobId}/update`, { cues });
      // 2. Continue with config
      onContinue({ ...renderConfig, subtitleMode });
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

  const noVideoRenderSelected = !renderConfig.renderSoft && !renderConfig.renderBurn;

  return (
    <div className="mt-6 animate-in fade-in zoom-in duration-300 relative">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-700">
        <div className="bg-slate-900 p-4 flex justify-between items-center text-white">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-800 transition-colors" title="Back to projects">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="bg-blue-600 text-xs px-2 py-1 rounded">Editor</span>
              Subtitle Review
            </h2>
          </div>
          
          <div className="flex gap-2 items-center">
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
              title={lastSaved ? `Last saved at ${lastSaved.toLocaleTimeString()}` : 'Save Draft'}
            >
              <Save className={`w-4 h-4 ${lastSaved && !hasUnsavedChanges ? 'text-emerald-400' : ''}`} />
              <span className="hidden sm:inline whitespace-nowrap">
                {lastSaved && !hasUnsavedChanges ? 'Saved' : 'Save Draft'}
              </span>
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

        <div className="grid grid-cols-1 lg:grid-cols-5 h-[850px]">
          {/* Video Player Column */}
          <div className="lg:col-span-2 bg-black flex flex-col relative group">
            <div className="h-[32%] flex items-start justify-center relative bg-black overflow-hidden">
                {/* Nested relative container that wraps the video content */}
                <div className="relative w-full h-full flex items-center justify-center bg-black">
                    <video 
                      ref={videoRef}
                      src={`http://localhost:3001${videoUrl}`} 
                      className="max-w-full max-h-full block mx-auto"
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleVideoLoad}
                      onDurationChange={handleVideoLoad}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onClick={togglePlay}
                    />
                    
                    {/* Overlay Preview */}
                    {activeCueIndex !== -1 && cues[activeCueIndex] && (
                      <div 
                          className="absolute left-0 right-0 px-8 text-center pointer-events-none flex flex-col items-center"
                          style={{ 
                              // Positioned in the bottom 1/4 of the video area
                              bottom: `${(renderConfig.burnConfig.marginV * previewScale) + 55}px` 
                          }}
                      >
                         <div 
                            style={{
                                fontSize: `${renderConfig.burnConfig.fontSize * previewScale * previewBoost}px`,
                                fontFamily: renderConfig.burnConfig.fontName,
                                lineHeight: renderConfig.burnConfig.lineHeight,
                                fontWeight: renderConfig.burnConfig.bold ? 'bold' : 'normal',
                                color: 'white', 
                                ...(renderConfig.burnConfig.borderStyle === 1 
                                    ? { 
                                        textShadow: `
                                            -${renderConfig.burnConfig.outline * previewScale * previewBoost}px -${renderConfig.burnConfig.outline * previewScale * previewBoost}px 0 #000,  
                                             ${renderConfig.burnConfig.outline * previewScale * previewBoost}px -${renderConfig.burnConfig.outline * previewScale * previewBoost}px 0 #000,
                                            -${renderConfig.burnConfig.outline * previewScale * previewBoost}px  ${renderConfig.burnConfig.outline * previewScale * previewBoost}px 0 #000,
                                             ${renderConfig.burnConfig.outline * previewScale * previewBoost}px  ${renderConfig.burnConfig.outline * previewScale * previewBoost}px 0 #000,
                                             0px ${2 * previewScale}px ${4 * previewScale}px rgba(0,0,0,0.5)
                                        `
                                      } 
                                    : { 
                                        backgroundColor: 'rgba(0,0,0,0.6)', 
                                        padding: `${4 * previewScale * previewBoost}px ${12 * previewScale * previewBoost}px`,
                                        borderRadius: `${4 * previewScale * previewBoost}px`,
                                        boxShadow: `0 ${2 * previewScale}px ${4 * previewScale}px rgba(0,0,0,0.2)`
                                      }
                                )
                            }}
                         >
                           {/* Overlay EN */}
                           {(displayMode === 'en' || displayMode === 'bilingual') && cues[activeCueIndex].en && (
                             <div>
                               {cues[activeCueIndex].en}
                             </div>
                           )}
                           {/* Overlay ZH */}
                           {(displayMode === 'zh' || displayMode === 'bilingual') && cues[activeCueIndex].zh && (
                             <div>
                               {cues[activeCueIndex].zh}
                             </div>
                           )}
                         </div>
                      </div>
                    )}
                </div>
            </div>

            {/* Custom Controls */}
            <div className="bg-slate-900 border-t border-slate-800 p-3 flex flex-col gap-2 shrink-0 select-none">
               {/* Timeline */}
               <input 
                 type="range" 
                 min="0" 
                 max={duration || 100} 
                 value={currentTime} 
                 onChange={handleSeek}
                 className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:bg-blue-400 focus:outline-none"
               />
               
               <div className="flex items-center justify-between text-white px-1">
                   <div className="flex items-center gap-4">
                       <button onClick={togglePlay} className="hover:text-blue-400 transition-colors focus:outline-none">
                           {isPlaying ? <Pause className="w-5 h-5"/> : <Play className="w-5 h-5"/>}
                       </button>
                       
                       {/* Volume Group */}
                       <div className="flex items-center gap-2 group/volume">
                           <button onClick={toggleMute} className="hover:text-blue-400 transition-colors focus:outline-none">
                               {isMuted || volume === 0 ? <VolumeX className="w-5 h-5"/> : <Volume2 className="w-5 h-5"/>}
                           </button>
                           <input 
                             type="range" 
                             min="0" 
                             max="1" 
                             step="0.05" 
                             value={isMuted ? 0 : volume} 
                             onChange={handleVolumeChange} 
                             className="w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-slate-400 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:bg-white focus:outline-none" 
                           />
                       </div>

                       {/* Playback Speed */}
                       <div className="relative group/speed">
                           <button 
                             onClick={cyclePlaybackRate}
                             className="text-xs font-medium text-slate-400 hover:text-white transition-colors border border-slate-700 rounded px-2 py-0.5 min-w-[40px]"
                           >
                               {playbackRate}x
                           </button>
                           <div className="absolute bottom-full left-1/2 -translate-x-1/2 hidden group-hover/speed:flex flex-col bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-20 after:content-[''] after:absolute after:h-1 after:w-full after:top-full after:left-0">
                               {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => (
                                   <button
                                       key={rate}
                                       onClick={() => handlePlaybackRateChange(rate)}
                                       className={`px-3 py-1.5 text-xs hover:bg-slate-700 text-center transition-colors ${playbackRate === rate ? 'text-blue-400 font-bold bg-slate-700/50' : 'text-slate-300'}`}
                                   >
                                       {rate}x
                                   </button>
                               ))}
                           </div>
                       </div>
                       
                       {/* Time Display */}
                       <div className="text-xs font-mono text-slate-400 ml-2">
                           {formatDisplayTime(currentTime)} / {formatDisplayTime(duration)}
                       </div>
                   </div>
               </div>
            </div>

            {/* NEW: Video Properties and Subtitle Settings */}
            <div className="bg-white dark:bg-slate-800 p-4 border-t border-slate-200 dark:border-slate-700 overflow-y-auto flex-1">
              <h3 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <FileVideo className="w-4 h-4" />
                Video Properties
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 truncate" title={originalFilename}>
                <span className="font-medium text-slate-600 dark:text-slate-300">File:</span> {originalFilename}
              </p>

              {/* Subtitle Settings Section (MOVED HERE) */}
              {/* Subtitle Settings Section (MOVED HERE) */}
              <div className="bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mt-4">
                  <h3 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <Settings className="w-4 h-4 mr-2" />
                    Subtitle Settings
                  </h3>
                  <div className="space-y-3">
                      {/* Display language toggle */}
                      <div className="flex items-center justify-between text-sm">
                          <label className="text-slate-600 dark:text-slate-300 font-medium text-xs">Display</label>
                          <div className="flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 shadow-sm rounded-lg p-1 text-xs text-slate-600 dark:text-slate-300">
                              <button
                                  type="button"
                                  onClick={() => handleDisplayModeChange('en')}
                                  className={`px-2 py-0.5 rounded-md transition-colors ${
                                  displayMode === 'en'
                                      ? 'bg-blue-500 text-white shadow-sm'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                                  }`}
                              >
                                  English
                              </button>
                              <button
                                  type="button"
                                  onClick={() => handleDisplayModeChange('zh')}
                                  className={`px-2 py-0.5 rounded-md transition-colors ${
                                  displayMode === 'zh'
                                      ? 'bg-blue-500 text-white shadow-sm'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                                  }`}
                              >
                                  Chinese
                              </button>
                              <button
                                  type="button"
                                  onClick={() => handleDisplayModeChange('bilingual')}
                                  className={`px-2 py-0.5 rounded-md transition-colors ${
                                  displayMode === 'bilingual'
                                      ? 'bg-blue-500 text-white shadow-sm'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                                  }`}
                              >
                                  Bilingual
                              </button>
                          </div>
                      </div>

                      {/* Chinese variant toggle */}
                      {(displayMode === 'zh' || displayMode === 'bilingual') && (
                          <div className="flex items-center justify-between text-sm animate-in fade-in duration-300">
                              <label className="text-slate-600 dark:text-slate-300 font-medium text-xs">Variant</label>
                              <div className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 shadow-sm rounded-lg p-1 text-xs">
                                  <button
                                      type="button"
                                      onClick={() => handleChineseVariantChange('simplified')}
                                      disabled={!converters.s2t || !converters.t2s}
                                      className={`px-2 py-0.5 rounded-md transition-colors ${
                                      chineseVariant === 'simplified'
                                          ? 'bg-green-500 text-white shadow-sm'
                                          : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                                      } disabled:opacity-30 disabled:cursor-not-allowed`}
                                  >
                                      Simplified
                                  </button>
                                  <button
                                      type="button"
                                      onClick={() => handleChineseVariantChange('traditional')}
                                      disabled={!converters.s2t || !converters.t2s}
                                      className={`px-2 py-0.5 rounded-md transition-colors ${
                                      chineseVariant === 'traditional'
                                          ? 'bg-green-500 text-white shadow-sm'
                                          : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                                      } disabled:opacity-30 disabled:cursor-not-allowed`}
                                  >
                                      Traditional
                                  </button>
                              </div>
                          </div>
                      )}

                      {/* Burn Settings Divider */}
                      <div className="h-px bg-slate-200 dark:bg-slate-600 my-2"></div>
                      
                      <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Burn Style</h4>

                      {/* Font Size & Line Height */}
                      <div className="grid grid-cols-2 gap-3">
                           <div>
                               <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Font Size</label>
                               <input 
                                 type="number" 
                                 value={renderConfig.burnConfig.fontSize}
                                 onChange={e => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, fontSize: parseInt(e.target.value) || 0}}))}
                                 className="w-full p-1.5 text-xs border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded"
                               />
                           </div>
                           <div>
                               <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Line Height</label>
                               <input 
                                 type="number"
                                 step="0.1"
                                 value={renderConfig.burnConfig.lineHeight}
                                 onChange={e => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, lineHeight: parseFloat(e.target.value) || 0}}))}
                                 className="w-full p-1.5 text-xs border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded"
                               />
                           </div>
                      </div>

                      {/* Margin */}
                      <div>
                           <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Vertical Margin</label>
                           <input 
                             type="number" 
                             value={renderConfig.burnConfig.marginV}
                             onChange={e => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, marginV: parseInt(e.target.value) || 0}}))}
                             className="w-full p-1.5 text-xs border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded"
                           />
                      </div>

                      {/* Background Style */}
                      <div>
                           <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Background</label>
                           <div className="grid grid-cols-2 gap-2">
                               <button 
                                 onClick={() => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, borderStyle: 1}}))}
                                 className={`p-1.5 text-xs rounded border transition-colors ${renderConfig.burnConfig.borderStyle === 1 ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 dark:border-blue-500 text-blue-700 dark:text-blue-300 font-medium' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 dark:text-slate-200'}`}
                               >
                                   Outline
                               </button>
                               <button 
                                 onClick={() => setRenderConfig(prev => ({...prev, burnConfig: {...prev.burnConfig, borderStyle: 3}}))}
                                 className={`p-1.5 text-xs rounded border transition-colors ${renderConfig.burnConfig.borderStyle === 3 ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 dark:border-blue-500 text-blue-700 dark:text-blue-300 font-medium' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 dark:text-slate-200'}`}
                               >
                                   Box
                               </button>
                           </div>
                      </div>
                  </div>
              </div>
            </div>
          </div>

          {/* Subtitle List Column */}
          <div className="lg:col-span-3 bg-slate-50 dark:bg-slate-900 overflow-y-auto border-l border-slate-200 dark:border-slate-700 p-4">

            
            {/* List header */}
            <div className="mb-3 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                Subtitle Segments
              </span>
            </div>

             {/* Add Start Button */}
             <button 
                onClick={() => handleInsertCue(0, 'start')}
                className="w-full py-2 mb-4 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg transition-colors"
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
                    ? 'border-blue-500 bg-white dark:bg-slate-800 shadow-md ring-1 ring-blue-500' 
                    : 'border-transparent bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 shadow-sm'
                }`}
               >
                 {/* Flex wrap added to prevent overflow */}
                 <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
                    <div className="flex gap-2 items-center shrink-0 bg-slate-50 dark:bg-slate-700/50 p-1.5 rounded-lg border border-slate-100 dark:border-slate-700">
                      <button 
                        onClick={(e) => handleSetTime(idx, 'start', e)}
                        className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                        title="Set start to current video time"
                      >
                         <MapPin className="w-3.5 h-3.5" />
                      </button>
                      <input 
                        type="text" 
                        value={cue.start}
                        onClick={(e) => e.stopPropagation()} 
                        onChange={(e) => updateCue(idx, 'start', e.target.value)}
                        className="w-28 text-xs font-mono bg-white dark:bg-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                      />
                      <span className="text-slate-300 dark:text-slate-600 text-xs">→</span>
                      <input 
                        type="text" 
                        value={cue.end}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateCue(idx, 'end', e.target.value)}
                        className="w-28 text-xs font-mono bg-white dark:bg-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                      />
                      <button 
                        onClick={(e) => handleSetTime(idx, 'end', e)}
                        className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                        title="Set end to current video time"
                      >
                         <MapPin className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                          onClick={(e) => handleSplitCue(idx, e)}
                          className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-md transition-colors"
                          title="Split at current video time"
                        >
                          <Scissors className="w-4 h-4" />
                      </button>
                      {idx > 0 && (
                        <button 
                          onClick={(e) => handleMergePrevious(idx, e)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors"
                          title="Merge with previous"
                        >
                          <Merge className="w-4 h-4" />
                        </button>
                      )}
                      <button 
                        onClick={(e) => handleDeleteCue(idx, e)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                 </div>

                 <div className="space-y-3">
                   {/* EN text area – hide when Chinese-only mode */}
                   {displayMode !== 'zh' && (
                     <div className="relative">
                       <textarea
                         value={cue.en}
                         onClick={(e) => e.stopPropagation()}
                         onChange={(e) => updateCue(idx, 'en', e.target.value)}
                         rows={2}
                         className="w-full text-sm p-3 pb-6 border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50 outline-none resize-none font-medium text-slate-800 placeholder-slate-400 transition-all"
                         placeholder="English text..."
                       />
                       <span className="absolute bottom-2 right-3 text-[10px] text-slate-400 font-mono">
                         {cue.en.length}
                       </span>
                     </div>
                   )}
                   {/* ZH text area – hide when English-only mode */}
                   {displayMode !== 'en' && (
                     <div className="relative">
                       <textarea
                         value={cue.zh}
                         onClick={(e) => e.stopPropagation()}
                         onChange={(e) => updateCue(idx, 'zh', e.target.value)}
                         rows={2}
                         className="w-full text-sm p-3 pb-6 border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50 outline-none resize-none text-slate-600 placeholder-slate-400 transition-all"
                         placeholder="Chinese text..."
                       />
                       <span className="absolute bottom-2 right-3 text-[10px] text-slate-400 font-mono">
                         {cue.zh.length}
                       </span>
                     </div>
                   )}
                 </div>
               </div>
               
               {/* Add Between Button - Visual divider that appears on hover */}
               <div className="h-4 -my-3 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10 relative group/add">
                   <div className="absolute inset-x-0 h-px bg-blue-200 dark:bg-blue-900"></div>
                   <button 
                     onClick={(e) => { e.stopPropagation(); handleInsertCue(idx, 'after'); }}
                     className="relative bg-white dark:bg-slate-700 text-blue-500 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-full p-1.5 shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:scale-110 transition-transform"
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
                className="w-full py-2 mt-4 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg transition-colors"
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
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
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
                           <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Burn Preview</label>
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
                                        {/* Match burn preview language(s) to current display mode */}
                                        {displayMode !== 'zh' && (
                                          <div>This is a sample subtitle</div>
                                        )}
                                        {displayMode !== 'en' && (
                                          <div>这是一行示例字幕</div>
                                        )}
                                    </div>
                                </div>
                           </div>
                       </div>
                   )}

                   {/* Outputs */}
                   <div className="space-y-3">
                       <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Output Files</label>
                       <label className="flex items-center gap-3 p-3 border dark:border-slate-700 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50">
                           <input 
                             type="checkbox" 
                             checked={renderConfig.renderSoft}
                             onChange={e => setRenderConfig(prev => ({ ...prev, renderSoft: e.target.checked }))}
                             className="w-5 h-5 text-blue-600 rounded" 
                           />
                           <div>
                               <div className="font-medium text-slate-800 dark:text-slate-200">Soft Subtitles (Muxed)</div>
                               <div className="text-xs text-slate-500 dark:text-slate-400">Embedded subtitles, switchable on/off</div>
                           </div>
                       </label>
                       <label className="flex items-center gap-3 p-3 border dark:border-slate-700 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50">
                           <input 
                             type="checkbox" 
                             checked={renderConfig.renderBurn}
                             onChange={e => setRenderConfig(prev => ({ ...prev, renderBurn: e.target.checked }))}
                             className="w-5 h-5 text-blue-600 rounded" 
                           />
                           <div>
                               <div className="font-medium text-slate-800 dark:text-slate-200">Hard Subtitles (Burned)</div>
                               <div className="text-xs text-slate-500 dark:text-slate-400">Permanently drawn onto video</div>
                           </div>
                       </label>
                   </div>

                   <div className="pt-2">
                       <button 
                         onClick={confirmRender}
                         className={`w-full py-3 text-white rounded-lg font-bold shadow-lg flex justify-center items-center gap-2 transition-colors ${noVideoRenderSelected ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                       >
                           {noVideoRenderSelected ? <Download className="w-5 h-5" /> : <RotateCw className="w-5 h-5" />}
                           {noVideoRenderSelected ? "Finish & Get SRT" : "Start Rendering"}
                       </button>
                   </div>
               </div>
           </div>
        </div>
      )}
    </div>
  );
};
