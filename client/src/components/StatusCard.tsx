import React from 'react';
import { JobStatus } from '../types';
import { STAGE_LABELS } from '../constants';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface StatusCardProps {
  job: JobStatus;
}

export const StatusCard: React.FC<StatusCardProps> = ({ job }) => {
  const isError = job.status === 'error';
  const isDone = job.status === 'done';
  const label = STAGE_LABELS[job.stage] || job.stage;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          {isError ? (
             <XCircle className="w-6 h-6 text-red-500" />
          ) : isDone ? (
            <CheckCircle2 className="w-6 h-6 text-green-500" />
          ) : (
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          )}
          <div>
            <h3 className="font-semibold text-slate-900">
              {isError ? 'Processing Failed' : isDone ? 'Generation Complete' : 'Processing Video'}
            </h3>
            <p className="text-sm text-slate-500">
              {isError ? job.error : job.message || label}
            </p>
          </div>
        </div>
        <span className="text-2xl font-bold text-slate-700">{job.progress}%</span>
      </div>

      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
        <div 
          className={`h-2.5 rounded-full transition-all duration-500 ease-out ${
            isError ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-blue-600'
          }`}
          style={{ width: `${job.progress}%` }}
        />
      </div>

      <div className="grid grid-cols-4 gap-2 mt-4 text-xs text-center text-slate-400">
        <div className={job.progress > 10 ? 'text-blue-600 font-medium' : ''}>Transcribe</div>
        <div className={job.progress > 30 ? 'text-blue-600 font-medium' : ''}>Translate</div>
        <div className={job.progress > 50 ? 'text-blue-600 font-medium' : ''}>Generate SRT</div>
        <div className={job.progress > 70 ? 'text-blue-600 font-medium' : ''}>Render</div>
      </div>
    </div>
  );
};