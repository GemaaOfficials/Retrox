# ReEditX Android

**Made by Gemaa.**

ReEditX is currently distributed for Android mobile only. This folder contains the Capacitor app that bundles the editor and the Retrox FFmpeg/WebAssembly core into a self-contained APK.

Video and soundtrack files are selected from the phone and processed locally inside Android's WebView. Projects are saved in the app's local storage. No login, cloud-render worker, or secret key is needed. The app exports MP4 locally through FFmpeg/WebAssembly, with a browser-based WebM fallback. Rendering can be slow on long or high-resolution clips.

## Download

The latest APK is published at:
https://github.com/GemaaOfficials/Retrox/releases/download/android-latest/ReEditX.apk

## Build locally

Requirements: Node.js 24, Java 21, and Android SDK.

    npm install
    npm run build:web
    npx cap add android
    npx cap sync android
    cd android
    ./gradlew assembleDebug

The `Build ReEditX Android APK` GitHub Actions workflow builds and publishes the APK to the `android-latest` GitHub Release.
