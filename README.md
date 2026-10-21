# ReEditX — Local Video Remix Studio

ReEditX is a local-first, deterministic video remix editor for Windows, Android, and the browser. Editing and export use on-device browser media APIs; there is no login, AI model, hosted rendering service, or backend secret to configure.

## Downloads

- **Windows:** [Get the latest ReEditX installer](https://github.com/GemaaOfficials/Retrox/releases/download/latest/ReEditX.setup-1.0.0.exe)
- **Android:** [Get the latest ReEditX APK](https://github.com/GemaaOfficials/Retrox/releases/download/android-latest/ReEditX.apk)
- **All releases:** [GitHub Releases](https://github.com/GemaaOfficials/Retrox/releases)

The Windows installer bundles a Node.js runtime and the local Next.js app. When launched, Electron starts the local server bound to 127.0.0.1 and opens the editing workspace from that local server. The Android APK bundles a static version of the app with Capacitor. Neither installed app needs a ReEditX server to edit or export media.

## Features

- Import a video and optional soundtrack from your device.
- Inspect the video locally and detect possible scene changes with a deterministic frame-difference heuristic.
- Edit rhythm, speed, aspect ratio, colour preset, audio levels and soundtrack fades.
- Add animated title and subtitle overlays.
- Preview the work and export MP4 locally through the bundled Retrox FFmpeg/WebAssembly engine, with a lightweight WebM fallback.
- Choose Cultural Aura, Lo-fi, Retro VHS, Cinema, Neon, Dream, Mono and Original style recipes; published recipe tuning syncs from Supabase, with local defaults when offline.
- Save project settings and source media in local IndexedDB storage without an account.

## Privacy and limitations

- ReEditX does not upload your selected media for rendering. The export button records the output locally on your device.
- Local export happens in real time and depends on the media codecs and recording APIs available in the operating system's browser/WebView.
- The Retrox engine exports MP4 locally; the lightweight fallback exports WebM. Browser/WASM processing can be slower and use substantial RAM on longer or high-resolution clips.
- Scene detection is a lightweight frame-difference heuristic, not an AI or professional vision model.
- Project media is stored in the app/browser profile. Clearing that app's data can remove locally saved projects.
- The installed builds bundle the editor and FFmpeg/WASM core locally. Supabase is queried only for the published style catalogue; source media and rendered output are never uploaded by Retrox.

## Development

Requirements: Node.js 22 or newer (Node 24 is recommended) and npm.

```bash
npm install
npm run dev
```

Visit http://localhost:3000 for the download portal and http://localhost:3000/studio for the editor.

Run checks:

```bash
npm run typecheck
npm run lint
npm run build
```

Windows installer packaging is performed by the `Build ReEditX.setup for Windows` GitHub Actions workflow. The Android package is built by `Build ReEditX Android APK`. Every build is self-contained for local editing and does not require configuring cloud services.
