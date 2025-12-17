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
