import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { DropZone } from './components/DropZone';
import { StatusCard } from './components/StatusCard';
import { PreviewPanel } from './components/PreviewPanel';
import { DownloadSection } from './components/DownloadSection';
import { JobStatus, UploadResponse } from './types';
import { API_BASE } from './constants';
import { Languages, AlertCircle } from 'lucide-react';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setJobId(null);
    setJobStatus(null);
    uploadFile(selectedFile);
  };

  const uploadFile = async (fileToUpload: File) => {
    const formData = new FormData();
    formData.append('file', fileToUpload);

    try {
      // NOTE: Do not manually set Content-Type for multipart/form-data; 
      // let the browser set it with the boundary.
      const res = await axios.post<UploadResponse>(`${API_BASE}/upload`, formData);
      setJobId(res.data.jobId);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.message || "Failed to upload file.");
    }
  };

  const pollStatus = async () => {
    if (!jobId) return;

    try {
      const res = await axios.get<JobStatus>(`${API_BASE}/status/${jobId}`);
      setJobStatus(res.data);

      if (res.data.status === 'done' || res.data.status === 'error') {
        if (pollIntervalRef.current) {
          window.clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    } catch (err) {
      console.error("Polling error", err);
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
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
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

        {/* Main Content */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 md:p-8">
          
          {/* Error Banner */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
              <div className="text-sm text-red-700">{error}</div>
              <button onClick={() => setError(null)} className="ml-auto text-red-500 font-bold hover:text-red-700">&times;</button>
            </div>
          )}

          {/* Upload Area */}
          {!jobId && !jobStatus && (
            <DropZone onFileSelect={handleFileSelect} isUploading={false} />
          )}

          {/* Progress Area */}
          {jobStatus && (
             <StatusCard job={jobStatus} />
          )}
          
          {/* Results Area */}
          {jobStatus?.status === 'done' && jobStatus.result && (
            <>
              <PreviewPanel cues={jobStatus.result.previewCues} />
              <DownloadSection result={jobStatus.result} />
              
              <div className="mt-8 text-center">
                 <button 
                  onClick={() => {
                    setFile(null);
                    setJobId(null);
                    setJobStatus(null);
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