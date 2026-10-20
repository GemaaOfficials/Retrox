# ReEditX — The Creator Engine

ReEditX is a creator-focused video remix studio with a Windows desktop setup package, a local-first web editor, and an optional dedicated FFmpeg render server. The editing logic is deterministic; the project does not require an AI model or AI API.

## Get the app

The download portal is the root route: `/`. It features an animated red-ribbon ReEditX.setup concept and checks GitHub Releases before downloading the Windows setup executable.

**The Windows installer is built and published automatically by the `Build ReEditX.setup for Windows` workflow on pushes to `main`. It refreshes the rolling `latest` GitHub Release with a versioned `ReEditX.setup-*.exe` asset. You can also start the workflow manually for a named version tag. The portal never fakes a download if the release asset is unavailable.

Workflow file: [release-desktop.yml](.github/workflows/release-desktop.yml)

Optional: configure a repository variable called `REEDITX_APP_URL` with the public HTTPS URL of the deployed ReEditX web app before building the setup. Electron will then open the hosted workspace (which can use the protected render server). If the variable is empty, the desktop build runs the bundled local Next.js app instead.

## Stack

- **Web app:** Next.js App Router, React, TypeScript.
- **Desktop setup:** Electron + electron-builder + Windows NSIS installer.
- **Local edit engine:** browser media APIs for preview, timeline interaction, title overlays and WebM export.
- **Server renderer:** separate Express service using FFmpeg/FFprobe. It accepts validated uploads, runs queued jobs, reports progress, and makes MP4 output downloadable.
- **Project storage:** IndexedDB persists project metadata and source media in the browser profile, without user accounts.
- **Backend proxy:** the Next.js server keeps the render API token private and streams upload, status and download requests to the render worker.

## Develop locally

Requirements: Node.js 22 or newer (Node 24 is recommended) and npm.

```bash
npm install
npm run dev
```

Visit http://localhost:3000. The root page is the setup/download portal; the actual editor is at http://localhost:3000/studio.

Run frontend checks:

```bash
npm run typecheck
npm run lint
npm run build
```

Desktop packaging (requires a Windows Node runtime at `build-runtime/node.exe`, generated automatically by the release workflow):

```bash
npm run build
npm run desktop:build
```

## Full architecture

```
ReEditX.setup.exe (Electron)
  └─ hosted ReEditX app, if REEDITX_APP_URL is configured
       ├─ Next.js web UI + API
       └─ private server-to-server proxy (render token never goes to browser)
            └─ ReEditX Render Worker (Express + FFmpeg)
                 ├─ in-memory render queue
                 ├─ temporary per-job files
                 └─ MP4 result + progress endpoint

Alternatively, desktop/local browser editing can run from the bundled Next.js app
without a hosted service and export WebM through browser media APIs.
```

## Dedicated render server deployment

The server implementation and container live under [server/](server/). For a Railway deployment:

1. Create a separate service from this repository and set its **Root Directory** to `/server`. Use the `server/Dockerfile` container (the `server/railway.json` config expects the service root to be `server`).
2. Configure `RENDER_API_TOKEN` to a long random secret, `MAX_UPLOAD_MB`, `MAX_CONCURRENT_RENDERS`, `MAX_QUEUED_RENDERS`, `TRUST_PROXY=1`, and an appropriate `CORS_ORIGINS` list. The Docker image installs FFmpeg, FFprobe, and fonts.
3. Deploy a separate web service from the repository root using the root `Dockerfile`. Set `REEDITX_RENDER_SERVER_URL` to the worker's public HTTPS URL and `REEDITX_RENDER_API_TOKEN` to the same token. These are **server-side variables**, not `NEXT_PUBLIC_*` variables.
4. Rebuild/redeploy the web app after setting its environment variables. Visit `/studio`; the **Render on server** button becomes enabled when the protected worker health check passes.

For local-only worker development, install FFmpeg/FFprobe on your machine, then:

```bash
cd server
npm install
# set RENDER_API_TOKEN to a long random token
npm run dev
```

The worker listens on port 8787 by default. In production it refuses authenticated render jobs if `RENDER_API_TOKEN` is not configured. Do not commit or put the secret in client-side code, desktop config, or repository variables that get baked into the app.

## Server API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Worker status and queue capacity |
| POST | `/api/render` | Upload video, optional song and JSON settings; returns a job ID |
| GET | `/api/jobs/:id` | Render status and progress |
| GET | `/api/jobs/:id/download` | Download the completed MP4 |

The Next.js proxy exposes corresponding routes under `/api/server-render` and injects the private worker token. Uploads are streamed through the proxy; job polling does not require client credentials.

## ReEditX features

- Upload and inspect videos locally; sample frames for possible scene changes.
- Interactive video/audio/text timeline layers and clickable scene markers.
- Cinema, Neon, Dream, Mono and Original presets, speed control and output aspect ratios.
- Music mixing, original audio gain, audio fades and animated title overlays.
- Local WebM export for no-server editing.
- Optional FFmpeg server render to MP4 for longer/heavier processing.
- Project source files/settings saved in IndexedDB; clear the workspace in the editor when needed.

## Limitations and trust notes

- Scene detection uses a lightweight frame-difference heuristic, not AI or a professional vision model.
- Local export happens in real time and depends on browser codec/hardware support.
- Server export uploads the chosen media to your configured render worker; do not use cloud rendering for private clips unless you trust the host. Local export remains available.
- Server jobs are in memory and temporary files expire after the configured retention window. For a larger production deployment, add durable job storage/Redis, object storage, authenticated user sessions or quotas, and persistent logs.
- A built setup executable and a live cloud service are not created by source commits alone. The Windows release workflow must run, and the render/web service must be deployed with the correct environment variables.
