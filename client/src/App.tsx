
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { DropZone } from './components/DropZone';
import { StatusCard } from './components/StatusCard';
import { PreviewPanel } from './components/PreviewPanel';
import { DownloadSection } from './components/DownloadSection';
import { SubtitleEditor } from './components/SubtitleEditor';
import { JobStatus, UploadResponse, SavedJob, RenderConfig, SourceLanguage, OutputFormat } from './types';
import { API_BASE } from './constants';
import { Languages, AlertCircle, FileText, FileVideo, RefreshCw, FolderOpen, Clock, Settings2, AlignLeft, Globe2, ChevronDown, ChevronUp, Sparkles, Type, Wand2 } from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState<'new' | 'resume' | 'retranslate'>('new');
  
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
  
  // State for "Resume" & "Retranslate" mode
  const [resumeVideo, setResumeVideo] = useState<File | null>(null);
  const [resumeSrt, setResumeSrt] = useState<File | null>(null);
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([]);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  // --- Reset when switching tabs ---
  const handleTabChange = (tab: 'new' | 'resume' | 'retranslate') => {
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

  const handleRetranslateSubmit = async () => {
    if (!resumeVideo || !resumeSrt) {
        setError("Please select both a video file and an SRT file.");
        return;
    }
    setError(null);
    setIsStarting(true);

    const formData = new FormData();
    formData.append('video', resumeVideo);
    formData.append('srt', resumeSrt);
    formData.append('sourceLang', sourceLang);
    formData.append('outputFormat', outputFormat);

    try {
        const res = await axios.post<UploadResponse>(`${API_BASE}/retranslate`, formData);
        setJobId(res.data.jobId);
    } catch (err: any) {
        console.error(err);
        setError(err.response?.data?.error || err.message || "Failed to upload files.");
        setIsStarting(false);
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

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-blue-600 rounded-2xl shadow-lg mb-4">
            <Languages className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2">
            Bilingual Subtitle Generator
          </h1>
          <p className="text-lg text-slate-600 max-w-xl mx-auto">
            Professional AI-powered subtitles in English & Chinese. Now with custom transcripts and flexible formats.
          </p>
        </div>

        {/* Navigation Tabs */}
        {!jobId && !jobStatus && (
            <div className="flex justify-center mb-6">
                <div className="bg-white p-1 rounded-lg border border-slate-200 shadow-sm flex space-x-1">
                    <button
                        onClick={() => handleTabChange('new')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'new' ? 'bg-blue-100 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Generate New
                    </button>
                    <button
                        onClick={() => handleTabChange('resume')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'resume' ? 'bg-blue-100 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Resume Project
                    </button>
                    <button
                        onClick={() => handleTabChange('retranslate')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'retranslate' ? 'bg-blue-100 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Improve Translation
                    </button>
                </div>
            </div>
        )}

        {/* Main Content */}
        <div className={`transition-all duration-300 ${jobStatus?.status === 'waiting_for_approval' ? '' : 'bg-white rounded-2xl shadow-xl border border-slate-100 p-6 md:p-8'}`}>
          
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
              <div className="text-sm text-red-700">{error}</div>
              <button onClick={() => setError(null)} className="ml-auto text-red-500 font-bold hover:text-red-700">&times;</button>
            </div>
          )}

          {/* MODE: Generate New */}
          {!jobId && !jobStatus && activeTab === 'new' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              
              {/* Step 1: File Selection */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                   <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">1</div>
                   <h3 className="font-semibold text-slate-800">Select Video</h3>
                </div>
                <DropZone onFileSelect={handleFileSelect} isUploading={isStarting} />
                {file && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-2 rounded-lg border border-blue-100">
                     <FileVideo className="w-4 h-4" />
                     <span className="font-medium truncate">{file.name}</span>
                     <button onClick={() => setFile(null)} className="ml-auto hover:text-blue-800">Change</button>
                  </div>
                )}
              </div>

              {/* Step 2: Configuration */}
              <div className={file ? "opacity-100" : "opacity-40 pointer-events-none"}>
                <div className="flex items-center gap-2 mb-4">
                   <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">2</div>
                   <h3 className="font-semibold text-slate-800">Configure Project</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {/* Source Lang */}
                   <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                         <Globe2 className="w-4 h-4" /> Video Spoken In
                      </label>
                      <div className="flex p-1 bg-slate-100 rounded-lg">
                         <button 
                           onClick={() => setSourceLang('en')}
                           className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${sourceLang === 'en' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            English
                         </button>
                         <button 
                           onClick={() => setSourceLang('zh')}
                           className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${sourceLang === 'zh' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            Chinese
                         </button>
                      </div>
                   </div>

                   {/* Output Format */}
                   <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                         <AlignLeft className="w-4 h-4" /> Subtitle Format
                      </label>
                      <div className="flex p-1 bg-slate-100 rounded-lg">
                         <button 
                           onClick={() => setOutputFormat('en')}
                           className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${outputFormat === 'en' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            EN Only
                         </button>
                         <button 
                           onClick={() => setOutputFormat('zh')}
                           className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${outputFormat === 'zh' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            ZH Only
                         </button>
                         <button 
                           onClick={() => setOutputFormat('bilingual')}
                           className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${outputFormat === 'bilingual' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            Bilingual
                         </button>
                      </div>
                   </div>
                </div>

                {/* Line Count (Only for EN or ZH only) */}
                {outputFormat !== 'bilingual' && (
                  <div className="mt-6 space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                       <Type className="w-4 h-4" /> Line Mode
                    </label>
                    <div className="flex p-1 bg-slate-100 rounded-lg max-w-sm">
                       <button 
                         onClick={() => setLineCount(1)}
                         className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${lineCount === 1 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                       >
                          Single Line
                       </button>
                       <button 
                         onClick={() => setLineCount(2)}
                         className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${lineCount === 2 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                       >
                          Double Lines
                       </button>
                    </div>
                    <p className="text-xs text-slate-400">
                      {lineCount === 1 ? "Keep subtitles as concise as possible in one row." : "Allow subtitles to span across two rows for better readability."}
                    </p>
                  </div>
                )}

                {/* Optional Transcripts */}
                <div className="mt-6 border border-slate-200 rounded-xl overflow-hidden">
                   <button 
                      onClick={() => setShowTranscripts(!showTranscripts)}
                      className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
                   >
                      <div className="flex items-center gap-3">
                         <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
                            <Sparkles className="w-4 h-4" />
                         </div>
                         <div className="text-left">
                            <div className="font-semibold text-slate-800 text-sm">Transcript Assistance</div>
                            <div className="text-xs text-slate-500">Provide text to help AI generate more accurate segments</div>
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
                              className="w-full h-32 p-3 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all"
                           />
                        </div>
                        <div className="space-y-2">
                           <label className="text-xs font-bold text-slate-400 uppercase">Chinese Transcript</label>
                           <textarea 
                              value={zhTranscript}
                              onChange={(e) => setZhTranscript(e.target.value)}
                              placeholder="粘贴中文文本..."
                              className="w-full h-32 p-3 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all"
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

          {/* MODE: Resume Project */}
          {!jobId && !jobStatus && activeTab === 'resume' && (
            <div className="space-y-8 animate-in fade-in duration-500">
                {savedJobs.length > 0 && (
                    <div className="space-y-3">
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                            <FolderOpen className="w-5 h-5 text-blue-600"/>
                            Recent Projects (Server)
                        </h3>
                        <div className="grid gap-3 max-h-60 overflow-y-auto">
                            {savedJobs.map(job => (
                                <button 
                                  key={job.id}
                                  onClick={() => handleLoadJob(job.id)}
                                  className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all text-left group"
                                >
                                    <div>
                                        <div className="font-medium text-slate-700 group-hover:text-blue-700 truncate max-w-[200px] sm:max-w-md">
                                            {job.originalFilename}
                                        </div>
                                        <div className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                                            <Clock className="w-3 h-3"/>
                                            {new Date(job.lastModified).toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="px-3 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                        Open
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                
                {savedJobs.length > 0 && <div className="border-t border-slate-100"></div>}

                <div>
                    <h3 className="font-semibold text-slate-800 mb-3">Or Upload Files</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:bg-slate-50 transition-colors relative">
                            <input 
                                type="file" 
                                accept="video/*" 
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={(e) => setResumeVideo(e.target.files?.[0] || null)}
                            />
                            <div className="flex flex-col items-center">
                                <FileVideo className={`w-8 h-8 mb-2 ${resumeVideo ? 'text-blue-600' : 'text-slate-400'}`} />
                                <span className="font-medium text-slate-700">{resumeVideo ? resumeVideo.name : "Select Video File"}</span>
                            </div>
                        </div>
                        <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:bg-slate-50 transition-colors relative">
                            <input 
                                type="file" 
                                accept=".srt" 
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={(e) => setResumeSrt(e.target.files?.[0] || null)}
                            />
                            <div className="flex flex-col items-center">
                                <FileText className={`w-8 h-8 mb-2 ${resumeSrt ? 'text-purple-600' : 'text-slate-400'}`} />
                                <span className="font-medium text-slate-700">{resumeSrt ? resumeSrt.name : "Select SRT File"}</span>
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

          {/* MODE: Improve Translation */}
          {!jobId && !jobStatus && activeTab === 'retranslate' && (
            <div className="space-y-8 animate-in fade-in duration-500">
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-blue-700 text-sm flex items-start gap-3">
                   <Wand2 className="w-5 h-5 shrink-0 mt-0.5" />
                   <div>
                     <span className="font-bold">Translate-Only Mode:</span> This will take your existing SRT file and use AI to regenerate/improve the translated second line while preserving your timestamps.
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:bg-slate-50 transition-colors relative">
                        <input 
                            type="file" 
                            accept="video/*" 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => setResumeVideo(e.target.files?.[0] || null)}
                        />
                        <div className="flex flex-col items-center">
                            <FileVideo className={`w-8 h-8 mb-2 ${resumeVideo ? 'text-blue-600' : 'text-slate-400'}`} />
                            <span className="font-medium text-slate-700">{resumeVideo ? resumeVideo.name : "Select Video File"}</span>
                        </div>
                    </div>
                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:bg-slate-50 transition-colors relative">
                        <input 
                            type="file" 
                            accept=".srt" 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => setResumeSrt(e.target.files?.[0] || null)}
                        />
                        <div className="flex flex-col items-center">
                            <FileText className={`w-8 h-8 mb-2 ${resumeSrt ? 'text-purple-600' : 'text-slate-400'}`} />
                            <span className="font-medium text-slate-700">{resumeSrt ? resumeSrt.name : "Select Source SRT"}</span>
                        </div>
                    </div>
                </div>

                {/* Retranslate Config */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                         <Globe2 className="w-4 h-4" /> Video Spoken In
                      </label>
                      <div className="flex p-1 bg-slate-100 rounded-lg">
                         <button 
                           onClick={() => setSourceLang('en')}
                           className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${sourceLang === 'en' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            English
                         </button>
                         <button 
                           onClick={() => setSourceLang('zh')}
                           className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${sourceLang === 'zh' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            Chinese
                         </button>
                      </div>
                   </div>

                   <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                         <AlignLeft className="w-4 h-4" /> New Output Format
                      </label>
                      <div className="flex p-1 bg-slate-100 rounded-lg">
                         <button 
                           onClick={() => setOutputFormat('en')}
                           className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${outputFormat === 'en' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            EN Only
                         </button>
                         <button 
                           onClick={() => setOutputFormat('zh')}
                           className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${outputFormat === 'zh' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            ZH Only
                         </button>
                         <button 
                           onClick={() => setOutputFormat('bilingual')}
                           className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-md transition-all ${outputFormat === 'bilingual' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                         >
                            Bilingual
                         </button>
                      </div>
                   </div>
                </div>

                <button
                    onClick={handleRetranslateSubmit}
                    disabled={!resumeVideo || !resumeSrt || isStarting}
                    className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-95"
                >
                    {isStarting ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Wand2 className="w-6 h-6" />}
                    {isStarting ? "Submitting..." : "Improve Translation"}
                </button>
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
              initialCues={jobStatus.result.previewCues}
              videoUrl={jobStatus.result.rawVideoUrl || ''}
              onContinue={handleEditorContinue}
            />
          )}
          
          {/* Final Results Area */}
          {jobStatus?.status === 'done' && jobStatus.result && (
            <div className="animate-in zoom-in duration-300">
              <PreviewPanel cues={jobStatus.result.previewCues} />
              <DownloadSection result={jobStatus.result} />
              
              <div className="mt-8 text-center">
                 <button 
                  onClick={() => handleTabChange('new')}
                  className="text-sm text-slate-500 hover:text-blue-600 font-medium underline flex items-center justify-center gap-2 mx-auto"
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
      </div>
    </div>
  );
}

export default App;
