# Bilingual Subtitle Generator

A production-ready web application that generates 2-line bilingual subtitles (English + Chinese) for uploaded videos.

## Prerequisites

1.  **Node.js** (v18+)
2.  **FFmpeg**: Must be installed and available in your system path.
    *   Mac: `brew install ffmpeg`
    *   Windows: Download binaries and add to PATH.
    *   Linux: `sudo apt install ffmpeg`

## Setup & Run

### 1. Backend

Navigate to the `server` directory:

```bash
cd server
npm install
npm run dev
```

The server will start on `http://localhost:3001`.

### 2. Frontend

Navigate to the `client` directory:

```bash
cd client
npm install
npm run dev
```

The client will start on `http://localhost:5173`.

## Architecture

*   **Frontend**: React, TypeScript, Tailwind CSS (via CDN), Vite.
*   **Backend**: Node.js, Express, Multer (uploads), Fluent-FFmpeg (processing).
*   **Data**: Uploads and generated files are stored in `server/data/`.

## Simulation Note

The **Transcription** and **Translation** stages are currently simulated with a high-quality stub to ensure the app runs immediately without requiring heavy Python AI dependencies (Whisper/NMT). 

However, the **FFmpeg video processing** (Bilingual SRT generation, Soft Sub Muxing, and Hard Sub Burning) is **REAL**. The app will actually generate valid video files with the simulated subtitles.
