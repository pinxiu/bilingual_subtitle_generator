import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { DropZone } from './components/DropZone';
import { StatusCard } from './components/StatusCard';
import { PreviewPanel } from './components/PreviewPanel';
import { DownloadSection } from './components/DownloadSection';
import { SubtitleEditor } from './components/SubtitleEditor';
import { JobStatus, UploadResponse } from './types';
import { API_BASE } from './constants';
import { Languages, AlertCircle, FileText, FileVideo, RefreshCw } from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState<'new' | 'resume'>('new');
  
  // State for "New" mode
  const [file, setFile] = useState<File | null>(null);
  
  // State for "Resume" mode
  const [resumeVideo, setResumeVideo] = useState<File | null>(null);
  const [resumeSrt, setResumeSrt] = useState<File | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  // --- Reset when switching tabs ---
  const handleTabChange = (tab: 'new' | 'resume') => {
    setActiveTab(tab);
    setJobId(null);
    setJobStatus(null);
    setError(null);
    setFile(null);
    setResumeVideo(null);
    setResumeSrt(null);
    if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
    }
  };

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    uploadFile(selectedFile);
  };

  const uploadFile = async (fileToUpload: File) => {
    const formData = new FormData();
    formData.append('file', fileToUpload);

    try {
      const res = await axios.post<UploadResponse>(`${API_BASE}/upload`, formData);
      setJobId(res.data.jobId);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.message || "Failed to upload file.");
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

  const pollStatus = async () => {
    if (!jobId) return;

    try {
      const res = await axios.get<JobStatus>(`${API_BASE}/status/${jobId}`);
      setJobStatus(res.data);

      const s = res.data.status;
      // Stop polling if done, error, OR waiting for user approval
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
      // Start polling
      pollIntervalRef.current = window.setInterval(pollStatus, 1000);
    }
    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

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
            Upload a video to automatically generate professional, 2-line English & Chinese subtitles.
          </p>
        </div>

        {/* Navigation Tabs (Only visible if no job is active) */}
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
                        Resume Editing
                    </button>
                </div>
            </div>
        )}

        {/* Main Content */}
        <div className={`transition-all duration-300 ${jobStatus?.status === 'waiting_for_approval' ? '' : 'bg-white rounded-2xl shadow-xl border border-slate-100 p-6 md:p-8'}`}>
          
          {/* Error Banner */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
              <div className="text-sm text-red-700">{error}</div>
              <button onClick={() => setError(null)} className="ml-auto text-red-500 font-bold hover:text-red-700">&times;</button>
            </div>
          )}

          {/* MODE: Generate New */}
          {!jobId && !jobStatus && activeTab === 'new' && (
            <DropZone onFileSelect={handleFileSelect} isUploading={false} />
          )}

          {/* MODE: Resume / Upload Existing */}
          {!jobId && !jobStatus && activeTab === 'resume' && (
            <div className="space-y-6">
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
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                >
                    <RefreshCw className="w-5 h-5" />
                    Load Editor
                </button>
            </div>
          )}

          {/* Progress Area - Hide during editor phase */}
          {jobStatus && jobStatus.status !== 'waiting_for_approval' && (
             <StatusCard job={jobStatus} />
          )}

          {/* Editor Area */}
          {jobStatus?.status === 'waiting_for_approval' && jobStatus.result && (
            <SubtitleEditor 
              jobId={jobStatus.id}
              initialCues={jobStatus.result.previewCues}
              videoUrl={jobStatus.result.rawVideoUrl || ''}
              onContinue={() => {
                // Manually update local state to "processing" immediately for UI feedback
                // while polling restarts
                setJobStatus({ ...jobStatus, status: 'processing', stage: 'render_soft', message: 'Resuming...' });
                resumePolling();
              }}
            />
          )}
          
          {/* Final Results Area */}
          {jobStatus?.status === 'done' && jobStatus.result && (
            <>
              <PreviewPanel cues={jobStatus.result.previewCues} />
              <DownloadSection result={jobStatus.result} />
              
              <div className="mt-8 text-center">
                 <button 
                  onClick={() => {
                    handleTabChange('new');
                  }}
                  className="text-sm text-slate-500 hover:text-blue-600 font-medium underline"
                 >
                   Process another video
                 </button>
              </div>
            </>
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