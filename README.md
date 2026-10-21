# ReEditX — Mobile Video Remix Studio

**Made by Gemaa.**

ReEditX is a mobile-first video remix editor. The supported app download is the **Android APK**; the Windows desktop build has been discontinued while the mobile version is the focus.

## Download for Android

**[Download the latest ReEditX APK](https://github.com/GemaaOfficials/Retrox/releases/download/android-latest/ReEditX.apk)**

If the download does not begin, open the [ReEditX Android release page](https://github.com/GemaaOfficials/Retrox/releases/tag/android-latest) and select `ReEditX.apk`. After downloading, open the APK on your Android phone and follow Android's installation prompts. Android may ask you to allow installation from the browser or file manager you used to download it.

## Features

- Import a video and optional soundtrack from your phone.
- Detect possible scene changes with a deterministic frame-difference heuristic.
- Edit rhythm, speed, aspect ratio, colour preset, audio levels, and soundtrack fades.
- Add animated title and subtitle overlays.
- Preview and export video locally through the bundled Retrox FFmpeg/WebAssembly engine, with a lightweight WebM fallback.
- Choose Cultural Aura, Lo-fi, Retro VHS, Cinema, Neon, Dream, Mono, and Original style recipes.
- Save project settings and source media on the device without an account.

## Privacy and limitations

- ReEditX processes selected media locally on your device; it does not upload source video or rendered output for processing.
- Export performance depends on your phone's available memory, media codecs, and WebView capabilities. Longer or high-resolution clips may take time and use substantial memory.
- The Retrox engine exports MP4 locally; the lightweight fallback exports WebM.
- Projects live in the app's local storage. Clearing the app's data can remove saved projects.
- The app does not require a login or a cloud-render service.

## Development

The Android app lives in `mobile/` and is built using Capacitor. The GitHub Actions workflow named `Build ReEditX Android APK` builds and publishes the APK to the `android-latest` release.

**ReEditX is currently distributed for Android mobile only.**
