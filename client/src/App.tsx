
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { DropZone } from './components/DropZone';
import { StatusCard } from './components/StatusCard';
import { PreviewPanel } from './components/PreviewPanel';
import { DownloadSection } from './components/DownloadSection';
import { SubtitleEditor } from './components/SubtitleEditor';
import { JobStatus, UploadResponse, SavedJob, RenderConfig, SourceLanguage, OutputFormat } from './types';
import { API_BASE } from './constants';
import { Languages, AlertCircle, FileText, FileVideo, RefreshCw, FolderOpen, Clock, Settings2, AlignLeft, Globe2, ChevronDown, ChevronUp, Sparkles, Type, MoreVertical, Check, X, Edit2, Trash2, Search, Moon, Sun } from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState<'new' | 'resume'>('new');

  // Configuration States
  const [sourceLang, setSourceLang] = useState<SourceLanguage>('en');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('bilingual');
  const [lineCount, setLineCount] = useState<1 | 2>(1);
  const [enTranscript, setEnTranscript] = useState('');
  const [zhTranscript, setZhTranscript] = useState('');
  const [showTranscripts, setShowTranscripts] = useState(false);

  // State for "New" mode
  const [file, setFile] = useState<File | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  
  // State for "Resume" mode
  const [resumeVideo, setResumeVideo] = useState<File | null>(null);
  const [resumeSrt, setResumeSrt] = useState<File | null>(null);
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([]);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  // Renaming State
  const [renamingJobId, setRenamingJobId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{top: number, left: number} | null>(null);

  // Dark Mode State
  const [isDarkMode, setIsDarkMode] = useState(() => {
      // Check local storage or system preference
      const saved = localStorage.getItem('theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
      const root = window.document.documentElement;
      if (isDarkMode) {
          root.classList.add('dark');
          localStorage.setItem('theme', 'dark');
      } else {
          root.classList.remove('dark');
          localStorage.setItem('theme', 'light');
      }
  }, [isDarkMode]);

  // Close menu when clicking outside
  useEffect(() => {
    const closeMenu = () => {
        setMenuOpenId(null);
        setMenuPosition(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const handleRenameStart = (job: SavedJob, e: React.MouseEvent) => {
      e.stopPropagation();
      setRenamingJobId(job.id);
      setNewName(job.originalFilename);
      setMenuOpenId(null);
      setMenuPosition(null);
  };

  const handleRenameSubmit = async (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!renamingJobId || !newName.trim()) return;
      
      try {
          await axios.post(`${API_BASE}/job/${renamingJobId}/rename`, { newName });
          setRenamingJobId(null);
          fetchSavedJobs();
      } catch (err) {
          console.error("Failed to rename");
          setError("Failed to rename project");
      }
  };

  const handleRenameCancel = (e: React.MouseEvent) => {
      e.stopPropagation();
      setRenamingJobId(null);
      setNewName('');
  };

  const handleDeleteProject = async (job: SavedJob, e: React.MouseEvent) => {
      e.stopPropagation();
      setMenuOpenId(null);
      setMenuPosition(null);
      
      if (!window.confirm(`Are you sure you want to delete "${job.originalFilename}"? This cannot be undone.`)) {
          return;
      }

      try {
          await axios.delete(`${API_BASE}/job/${job.id}`);
          fetchSavedJobs();
      } catch (err) {
          console.error("Failed to delete job", err);
          setError("Failed to delete project");
      }
  };
  
  const handleMenuToggle = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (menuOpenId === id) {
          setMenuOpenId(null);
          setMenuPosition(null);
      } else {
          const rect = e.currentTarget.getBoundingClientRect();
          setMenuOpenId(id);
          setMenuPosition({
              top: rect.bottom + 5,
              left: rect.right - 128 // align right, assuming 128px (w-32) width
          });
      }
  };

  // --- Reset when switching tabs ---
  const handleTabChange = (tab: 'new' | 'resume') => {
    setActiveTab(tab);
    setJobId(null);
    setJobStatus(null);
    setError(null);
    setFile(null);
    setResumeVideo(null);
    setResumeSrt(null);
    setIsStarting(false);
    if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
    }
    
    if (tab === 'resume') {
        fetchSavedJobs();
    }
  };

  const fetchSavedJobs = async () => {
      try {
          const res = await axios.get<SavedJob[]>(`${API_BASE}/jobs`);
          setSavedJobs(res.data);
      } catch (err) {
          console.error("Failed to fetch jobs");
      }
  };

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
  };

  const handleStartGeneration = async () => {
    if (!file) return;
    setIsStarting(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('sourceLang', sourceLang);
    formData.append('outputFormat', outputFormat);
    formData.append('lineCount', outputFormat === 'bilingual' ? '2' : lineCount.toString());
    formData.append('enTranscript', enTranscript);
    formData.append('zhTranscript', zhTranscript);

    try {
      const res = await axios.post<UploadResponse>(`${API_BASE}/upload`, formData);
      setJobId(res.data.jobId);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.message || "Failed to upload file.");
      setIsStarting(false);
    }
  };

  const handleResumeSubmit = async () => {
    if (!resumeVideo || !resumeSrt) {
        setError("Please select both a video file and an SRT file.");
        return;
    }
    setError(null);
    const formData = new FormData();
    formData.append('video', resumeVideo);
    formData.append('srt', resumeSrt);

    try {
        const res = await axios.post<UploadResponse>(`${API_BASE}/upload-existing`, formData);
        setJobId(res.data.jobId);
    } catch (err: any) {
        console.error(err);
        setError(err.response?.data?.error || err.message || "Failed to upload files.");
    }
  };

  const handleLoadJob = async (id: string) => {
      try {
          const res = await axios.post<{jobId: string}>(`${API_BASE}/job/${id}/load`);
          setJobId(res.data.jobId);
      } catch (err: any) {
          setError("Failed to load job. " + (err.response?.data?.error || ""));
      }
  };

  // When a job is already loaded and finished, allow reopening the editor
  // without reprocessing by locally switching back to waiting_for_approval.
  const handleReopenEditorForCurrentJob = () => {
    setJobStatus(prev => prev && prev.result
      ? { ...prev, status: 'waiting_for_approval', stage: 'user_review' }
      : prev
    );
  };

  const pollStatus = async () => {
    if (!jobId) return;

    try {
      const res = await axios.get<JobStatus>(`${API_BASE}/status/${jobId}`);
      setJobStatus(res.data);

      const s = res.data.status;
      if (s === 'done' || s === 'error' || s === 'waiting_for_approval') {
        if (pollIntervalRef.current) {
          window.clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    } catch (err) {
      console.error("Polling error", err);
    }
  };

  const resumePolling = () => {
     if (jobId && !pollIntervalRef.current) {
       pollIntervalRef.current = window.setInterval(pollStatus, 1000);
     }
  };

  useEffect(() => {
    if (jobId) {
      pollIntervalRef.current = window.setInterval(pollStatus, 1000);
    }
    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, [jobId]);
  
  const handleEditorContinue = async (config: RenderConfig) => {
     if (!jobId) return;
     try {
         await axios.post(`${API_BASE}/job/${jobId}/resume`, { config });
         setJobStatus(prev => prev ? { ...prev, status: 'processing', stage: 'render_soft', message: 'Starting render...' } : null);
         resumePolling();
     } catch (err) {
         setError("Failed to resume processing.");
     }
  };

  const filteredJobs = savedJobs.filter(job => 
    job.originalFilename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 py-12 px-4 sm:px-6 lg:px-8 font-sans transition-colors duration-200">
      <div className="max-w-6xl mx-auto relative">
        
        {/* Dark Mode Toggle */}
        <div className="absolute top-0 right-0">
            <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-blue-600 rounded-2xl shadow-lg mb-4">
            <Languages className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">
            Bilingual Subtitle Generator
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
            Professional AI-powered subtitles in English & Chinese. Now with custom transcripts and flexible formats.
          </p>
        </div>

        {/* Navigation Tabs */}
        {!jobId && !jobStatus && (
            <div className="flex justify-center mb-6">
                <div className="bg-white dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm flex space-x-1">
                    <button
                        onClick={() => handleTabChange('new')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'new' ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        Generate New
                    </button>
                    <button
                        onClick={() => handleTabChange('resume')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'resume' ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        Resume Editing
                    </button>
                </div>
            </div>
        )}

        {/* Main Content */}
        <div className={`transition-all duration-300 ${jobStatus?.status === 'waiting_for_approval' ? '' : 'bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 p-6 md:p-8'}`}>
          
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 mt-0.5" />
              <div className="text-sm text-red-700 dark:text-red-300">{error}</div>
              <button onClick={() => setError(null)} className="ml-auto text-red-500 font-bold hover:text-red-700">&times;</button>
            </div>
          )}

          {/* MODE: Generate New */}
          {!jobId && !jobStatus && activeTab === 'new' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              
              {/* Step 1: File Selection */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                   <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 flex items-center justify-center text-xs font-bold">1</div>
                   <h3 className="font-semibold text-slate-800 dark:text-slate-200">Select Video</h3>
                </div>
                <DropZone onFileSelect={handleFileSelect} isUploading={isStarting} />
                {file && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 p-2 rounded-lg border border-blue-100 dark:border-blue-800">
                     <FileVideo className="w-4 h-4" />
                     <span className="font-medium truncate">{file.name}</span>
                     <button onClick={() => setFile(null)} className="ml-auto hover:text-blue-800 dark:hover:text-blue-300">Change</button>
                  </div>
                )}
              </div>

              {/* Step 2: Configuration */}
              <div className={file ? "opacity-100" : "opacity-40 pointer-events-none"}>
                <div className="flex items-center gap-2 mb-4">
                   <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 flex items-center justify-center text-xs font-bold">2</div>
                   <h3 className="font-semibold text-slate-800 dark:text-slate-200">Configure Project</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {/* Source Lang */}
                   <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-2">
                         <Globe2 className="w-4 h-4" /> Video Spoken In
                      </label>
                      <div className="flex p-1 bg-slate-100 dark:bg-slate-700 rounded-lg">
                         <button 
                           onClick={() => setSourceLang('en')}
                           className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${sourceLang === 'en' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                         >
                            English
                         </button>
                         <button 
                           onClick={() => setSourceLang('zh')}
                           className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${sourceLang === 'zh' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                         >
                            Chinese
                         </button>
                      </div>
                   </div>

                   {/* Output Format */}
                   <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-2">
                         <AlignLeft className="w-4 h-4" /> Subtitle Format
                      </label>
                      <div className="flex p-1 bg-slate-100 dark:bg-slate-700 rounded-lg">
                         <button 
                           onClick={() => setOutputFormat('en')}
                           className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${outputFormat === 'en' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                         >
                            EN Only
                         </button>
                         <button 
                           onClick={() => setOutputFormat('zh')}
                           className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${outputFormat === 'zh' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                         >
                            ZH Only
                         </button>
                         <button 
                           onClick={() => setOutputFormat('bilingual')}
                           className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${outputFormat === 'bilingual' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                         >
                            Bilingual
                         </button>
                      </div>
                   </div>
                </div>

                {/* Line Count (Only for EN or ZH only) */}
                {outputFormat !== 'bilingual' && (
                  <div className="mt-6 space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-2">
                       <Type className="w-4 h-4" /> Line Mode
                    </label>
                    <div className="flex p-1 bg-slate-100 dark:bg-slate-700 rounded-lg max-w-sm">
                       <button 
                         onClick={() => setLineCount(1)}
                         className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${lineCount === 1 ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                       >
                          Single Line
                       </button>
                       <button 
                         onClick={() => setLineCount(2)}
                         className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${lineCount === 2 ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                       >
                          Double Lines
                       </button>
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {lineCount === 1 ? "Keep subtitles as concise as possible in one row." : "Allow subtitles to span across two rows for better readability."}
                    </p>
                  </div>
                )}

                {/* Optional Transcripts */}
                <div className="mt-6 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                   <button 
                      onClick={() => setShowTranscripts(!showTranscripts)}
                      className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                   >
                      <div className="flex items-center gap-3">
                         <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg text-purple-600 dark:text-purple-300">
                            <Sparkles className="w-4 h-4" />
                         </div>
                         <div className="text-left">
                            <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Transcript Assistance</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Provide text to help AI generate more accurate segments</div>
                         </div>
                      </div>
                      {showTranscripts ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                   </button>
                   
                   {showTranscripts && (
                     <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-top-2">
                        <div className="space-y-2">
                           <label className="text-xs font-bold text-slate-400 uppercase">English Transcript</label>
                           <textarea 
                              value={enTranscript}
                              onChange={(e) => setEnTranscript(e.target.value)}
                              placeholder="Paste English text here..."
                              className="w-full h-32 p-3 text-sm border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all"
                           />
                        </div>
                        <div className="space-y-2">
                           <label className="text-xs font-bold text-slate-400 uppercase">Chinese Transcript</label>
                           <textarea 
                              value={zhTranscript}
                              onChange={(e) => setZhTranscript(e.target.value)}
                              placeholder="粘贴中文文本..."
                              className="w-full h-32 p-3 text-sm border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all"
                           />
                        </div>
                     </div>
                   )}
                </div>
              </div>

              {/* Start Button */}
              <button 
                 onClick={handleStartGeneration}
                 disabled={!file || isStarting}
                 className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-95"
              >
                 {isStarting ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />}
                 {isStarting ? "Processing..." : "Start Generation"}
              </button>
            </div>
          )}

          {/* MODE: Resume / Upload Existing */}
          {!jobId && !jobStatus && activeTab === 'resume' && (
            <div className="space-y-8 animate-in fade-in duration-500">
                {savedJobs.length > 0 && (
                    <div className="space-y-0">
                        <div className="flex items-center justify-between mb-3 px-1">
                             <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <FolderOpen className="w-5 h-5 text-blue-600 dark:text-blue-400"/>
                                Recent Projects (Server)
                            </h3>
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                                <input 
                                    type="text" 
                                    placeholder="Search projects..." 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 pr-4 py-1.5 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48 transition-all placeholder-slate-400 dark:placeholder-slate-500"
                                />
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                            {/* Header */}
                            <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                <div className="col-span-6 md:col-span-7 pl-2">Title</div>
                                <div className="col-span-4 md:col-span-3">Created At</div>
                                <div className="col-span-2"></div>
                            </div>

                            {/* List */}
                            <div className="max-h-[500px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800">
                                {filteredJobs.map(job => (
                                    <div 
                                      key={job.id}
                                      onClick={() => renamingJobId !== job.id && handleLoadJob(job.id)}
                                      className={`grid grid-cols-12 gap-4 px-4 py-3 items-center transition-all cursor-pointer group ${renamingJobId === job.id ? 'bg-white dark:bg-slate-800' : 'hover:bg-blue-50 dark:hover:bg-blue-900/10'}`}
                                    >
                                        {renamingJobId === job.id ? (
                                            <div className="col-span-12 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                <input 
                                                    type="text"
                                                    value={newName}
                                                    onChange={(e) => setNewName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRenameSubmit();
                                                        if (e.key === 'Escape') handleRenameCancel(e as any);
                                                    }}
                                                    autoFocus
                                                    className="flex-1 p-1.5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                />
                                                <button onClick={handleRenameSubmit} className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded"><Check className="w-4 h-4"/></button>
                                                <button onClick={handleRenameCancel} className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"><X className="w-4 h-4"/></button>
                                            </div>
                                        ) : (
                                            <>
                                                {/* Title Column */}
                                                <div className="col-span-6 md:col-span-7 flex items-center gap-3 min-w-0 pl-2">
                                                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg shrink-0">
                                                        <FileVideo className="w-4 h-4" />
                                                    </div>
                                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate" title={job.originalFilename}>
                                                        {job.originalFilename}
                                                    </span>
                                                </div>

                                                {/* Date Column */}
                                                <div className="col-span-4 md:col-span-3 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                                    <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                                    <span className="truncate">{new Date(job.createdAt).toLocaleDateString()} <span className="text-xs opacity-70">{new Date(job.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span></span>
                                                </div>
                                                
                                                {/* Actions Column */}
                                                <div className="col-span-2 flex justify-end items-center gap-2 pr-2">
                                                    <div className="relative">
                                                        <button 
                                                            onClick={(e) => handleMenuToggle(job.id, e)}
                                                            className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                                        >
                                                            <MoreVertical className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                
                {savedJobs.length > 0 && <div className="border-t border-slate-100 dark:border-slate-700"></div>}

                <div>
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-3">Or Upload Files</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-6 text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative">
                            <input 
                                type="file" 
                                accept="video/*" 
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={(e) => setResumeVideo(e.target.files?.[0] || null)}
                            />
                            <div className="flex flex-col items-center">
                                <FileVideo className={`w-8 h-8 mb-2 ${resumeVideo ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className="font-medium text-slate-700 dark:text-slate-300">{resumeVideo ? resumeVideo.name : "Select Video File"}</span>
                            </div>
                        </div>
                        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-6 text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative">
                            <input 
                                type="file" 
                                accept=".srt" 
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={(e) => setResumeSrt(e.target.files?.[0] || null)}
                            />
                            <div className="flex flex-col items-center">
                                <FileText className={`w-8 h-8 mb-2 ${resumeSrt ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className="font-medium text-slate-700 dark:text-slate-300">{resumeSrt ? resumeSrt.name : "Select SRT File"}</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={handleResumeSubmit}
                        disabled={!resumeVideo || !resumeSrt}
                        className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                    >
                        <RefreshCw className="w-5 h-5" />
                        Load Editor
                    </button>
                </div>
            </div>
          )}

          {/* Progress Area */}
          {jobStatus && jobStatus.status !== 'waiting_for_approval' && (
             <StatusCard job={jobStatus} />
          )}

          {/* Editor Area */}
          {jobStatus?.status === 'waiting_for_approval' && jobStatus.result && (
            <SubtitleEditor 
              jobId={jobStatus.id}
              originalFilename={jobStatus.originalFilename}
              initialCues={jobStatus.result.previewCues}
              videoUrl={jobStatus.result.rawVideoUrl || ''}
              onContinue={handleEditorContinue}
              onBack={() => handleTabChange('resume')}
            />
          )}
          
          {/* Final Results Area */}
          {jobStatus?.status === 'done' && jobStatus.result && (
            <div className="animate-in zoom-in duration-300">
              <PreviewPanel cues={jobStatus.result.renderedPreviewCues || jobStatus.result.previewCues} />
              <DownloadSection result={jobStatus.result} />

              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                {/* Return to editor for this video without reprocessing */}
                 <button
                   onClick={handleReopenEditorForCurrentJob}
                   className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                 >
                   Adjust subtitles for this video
                 </button>
                 <button 
                   onClick={() => handleTabChange('new')}
                   className="text-sm text-slate-500 hover:text-blue-600 font-medium underline flex items-center justify-center gap-2"
                 >
                   <Sparkles className="w-4 h-4" />
                   Process another video
                 </button>
              </div>
            </div>
          )}

        </div>
        
        <p className="text-center text-slate-400 text-sm mt-8">
          Powered by Faster-Whisper, NMT & FFmpeg
        </p>

        {menuOpenId && menuPosition && (
            <div 
                className="fixed bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-100 dark:border-slate-700 z-50 py-1 animate-in fade-in zoom-in-95 duration-100 overflow-hidden w-32"
                style={{ top: menuPosition.top, left: menuPosition.left }}
                onClick={(e) => e.stopPropagation()}
            >
               {(() => {
                   const job = savedJobs.find(j => j.id === menuOpenId);
                   if (!job) return null;
                   return (
                       <>
                           <button 
                                onClick={(e) => handleRenameStart(job, e)}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                            >
                                <Edit2 className="w-3 h-3" />
                                Rename
                            </button>
                            <button 
                                onClick={(e) => handleDeleteProject(job, e)}
                                className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2"
                            >
                                <Trash2 className="w-3 h-3" />
                                Delete
                            </button>
                       </>
                   )
               })()}
            </div>
        )}
      </div>
    </div>
  );
}

export default App;
