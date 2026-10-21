# ReEditX — The Creator Engine

ReEditX is a creator-focused video remix studio with a Windows desktop setup package, a local-first web editor, and an optional dedicated FFmpeg render server. The editing logic is deterministic; the project does not require an AI model or AI API.

## Get the app

The download portal is the root route: `/`. It features an animated red-ribbon ReEditX.setup concept and checks GitHub Releases before downloading the Windows setup executable.

**The Windows installer is built and published automatically by the `Build ReEditX.setup for Windows` workflow on pushes to `main`. It refreshes the rolling `latest` GitHub Release with a versioned `ReEditX.setup-*.exe` asset. You can also start the workflow manually for a named version tag. The portal never fakes a download if the release asset is unavailable.**

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

## Supabase backend and FFmpeg runner

The ReEditX Supabase project is deployed in ap-south-1. It contains a private reeditx-media bucket, a locked-down reeditx_render_jobs table, an atomic queue-claim function, and a worker-heartbeat table. The reeditx-render-api Edge Function validates uploads, stores media privately, creates durable queue jobs, returns status, and produces signed download URLs. No login is required.

Storage is configured for 50 MB per file; combined source uploads are limited to 65 MB. Rendered MP4 outputs must fit the configured private bucket limit.

### Enable server rendering

1. Open the GitHub repository's [Actions secrets settings](https://github.com/GemaaOfficials/Retrox/settings/secrets/actions).
2. Create a repository secret named REEDITX_SUPABASE_SERVICE_ROLE_KEY using the service-role/secret API key from Supabase Dashboard → Project Settings → API Keys. Never paste this key into chat, commit it, or put it in browser code.
3. Open [ReEditX Supabase Render Worker](https://github.com/GemaaOfficials/Retrox/actions/workflows/supabase-render-worker.yml) and choose Run workflow for the first run. Scheduled runs start every five minutes.
4. The runner processes queued jobs on GitHub-hosted CPU, while the queue and media references live in Supabase. If the secret is missing, the worker reports a configuration error; browser-local editing continues to work.

Supabase Edge Functions do not encode complete videos because their hosted CPU and runtime limits are bounded. FFmpeg runs on the GitHub-hosted runner. Signed output URLs expire after 10 minutes.

The Edge Function source is at supabase/functions/reeditx-render-api/index.ts. The database bootstrap SQL is at supabase/schema.sql.
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
