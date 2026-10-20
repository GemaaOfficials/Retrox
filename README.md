# ReEditX — The Remix Studio

ReEditX is a full-stack Next.js video-editing app with a custom browser media engine. It requires no login and uses deterministic editing rules — no AI model or external AI API.

## Architecture

- **Frontend:** Next.js App Router + React + TypeScript; responsive editing workspace, preview monitor, layered timeline, look/sound/text panels, loading/inspection states and export progress.
- **Backend:** Next.js route handlers for health, edit-plan generation, and preset metadata. The edit planner is a deterministic rule-based engine, not AI.
- **Local media engine:** HTML video/canvas, Canvas 2D, MediaRecorder, and Web Audio for live composition and WebM export.
- **Autosave:** IndexedDB stores the project settings and source media blobs in the current browser profile. The server never receives the original video or song through these app routes.
- **Validation:** Zod validates edit-plan requests on the server; TypeScript and ESLint are included.

## Requirements

- Node.js **20.9 or newer** (recommended: Node.js 22)
- npm
- A current desktop browser with Canvas recording, MediaRecorder, and Web Audio support (Chrome/Edge recommended)

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Run checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Backend readiness and engine metadata |
| GET | `/api/presets` | Available visual treatments and rhythm presets |
| POST | `/api/edit-plan` | Validated deterministic pacing/scene-block plan |

Example edit-plan request:

```json
{ "duration": 92, "rhythm": "punchy", "preset": "cinema" }
```

## Local data and privacy

Project autosave uses IndexedDB because video/audio blobs exceed practical localStorage limits. Small preferences and media stay inside the browser profile on this device; no account or media-upload server is involved. Browser site-data clearing can remove saved projects. Use **Clear workspace** in the app to remove the current project.

The Google Fonts import in `app/globals.css` is optional and only affects typography; remove the import and the font will fall back to system sans-serif/monospace.

## Editing capabilities in this build

- Upload video, inspect dimensions/duration and sample frames locally for possible scene changes.
- Timeline blocks and clickable detected scene markers.
- Bring-your-own soundtrack, music volume, original-volume control and fade ramps.
- Cinema, Neon, Dream, Mono and Original visual treatments.
- Playback speed, portrait/square/landscape output presets and title/subtitle overlays.
- Animated fade-and-slide title treatment composited into exported frames.
- Real-time, in-browser WebM export.

## Known limits (honest MVP scope)

- Export happens in real time: keep the tab open and do not pause playback until it finishes.
- Output is WebM, not guaranteed MP4. Browser codec support and hardware affect export stability/performance.
- Scene detection is a local frame-difference heuristic, so it may miss cuts or flag fast movement/flashes. Markers are suggestions, not a professional vision model.
- The rhythm presets define deterministic pacing suggestions and preview speed. They do not yet reconstruct a complete beat-synchronized montage or automatically remove arbitrary sections.
- Browser capture APIs differ by browser; desktop Chrome/Edge is the recommended target.
- Large videos can use substantial browser storage and memory. IndexedDB quota is controlled by the browser/OS, not by ReEditX.

## Suggested next engineering steps

1. Add explicit split/trim controls and reversible clip operations in the timeline.
2. Add audio-waveform analysis and deterministic beat markers.
3. Add chunk-aware project storage, export cancellation and proper progress/error recovery.
4. Add Playwright browser-flow tests and a real-device media export test matrix.
