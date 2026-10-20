# ReEditX

A browser-first, no-login video remix studio. The MVP uses a custom editing UI and native browser media APIs — no AI service or account is required.

## Run it
Open `index.html` in a modern desktop browser, or serve the folder locally:
```bash
python -m http.server 8000
```
Visit http://localhost:8000.

## Features
- Upload and preview video; inspect duration and dimensions.
- Add a user-provided soundtrack and control music volume.
- Playback speed, visual treatments, frame-format presets, and rhythm presets.
- Canvas-based WebM recording/export using browser media APIs.
- Project-setting autosave in localStorage.
- No sign-in and no application server receives your media.

## MVP limitations
- Export is a real-time browser recording, not a full non-linear editing render pipeline. Keep the tab open and playing during export.
- Output is WebM where supported; MP4 export is not promised.
- Fade-in/out sliders are saved settings but do not yet apply a true automated audio envelope.
- Rhythm presets do not yet detect beats or automatically generate scene cuts.
- Settings persist locally, but source video/audio blobs are not stored in localStorage because browser storage quotas are limited. Reselect media after refresh.
- Current desktop Chrome or Edge is recommended.
- Media is processed in the browser. Google Fonts are not required; system fonts can be used for offline operation.

## Next milestones
1. IndexedDB project assets for optional local persistence.
2. Real timeline cuts, beat markers, audio fades, crop positioning, and reversible clips.
3. Web Worker / FFmpeg.wasm rendering for frame-accurate export and more formats.
4. Browser tests and accessibility checks.
