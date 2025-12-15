import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, FileVideo } from 'lucide-react';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
  isUploading: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({ onFileSelect, isUploading }) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles?.length > 0) {
      onFileSelect(acceptedFiles[0]);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.avi', '.mkv']
    },
    maxFiles: 1,
    disabled: isUploading
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors duration-200 
      ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}
      ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center justify-center space-y-4">
        <div className="p-4 bg-white rounded-full shadow-sm">
          {isDragActive ? (
            <FileVideo className="w-8 h-8 text-blue-500" />
          ) : (
            <UploadCloud className="w-8 h-8 text-slate-500" />
          )}
        </div>
        <div>
          <p className="text-lg font-medium text-slate-700">
            {isDragActive ? "Drop the video here" : "Drag & drop video here"}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            or click to browse file (MP4, MKV, MOV)
          </p>
        </div>
      </div>
    </div>
  );
};