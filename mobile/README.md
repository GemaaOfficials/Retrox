# ReEditX Android

This is the Capacitor wrapper for the ReEditX editor. The build script copies the current pages, styles, IndexedDB project storage, and local edit-plan logic into a static Next.js export, then Capacitor bundles the app into an Android APK.

Video and soundtrack files are selected from the device and processed by browser media APIs inside the Android WebView. Projects are saved in the app's local storage. No login, Supabase project, cloud render worker, or secret key is needed. Retrox bundles the FFmpeg/WebAssembly core in the APK and exports MP4 locally; a browser-based WebM fallback is also available. The first render can be slow, especially on phones.

Build locally with Node.js 24, Java 21, and Android SDK installed:

    npm install
    npm run build:web
    npx cap add android
    npx cap sync android
    cd android
    ./gradlew assembleDebug

The Build ReEditX Android APK GitHub Actions workflow compiles and publishes the APK to the android-latest GitHub Release.
