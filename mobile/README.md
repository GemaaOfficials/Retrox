# ReEditX Android

This is the Capacitor wrapper for the ReEditX portal and studio. Its build script copies the current root pages, styles, IndexedDB storage, and public Supabase client configuration into a static Next.js export, then Capacitor bundles that site into an Android APK.

Build locally with Node.js 24, Java 21, and Android SDK installed:

    npm install
    npm run build:web
    npx cap add android
    npx cap sync android
    cd android
    ./gradlew assembleDebug

The Build ReEditX Android APK GitHub Actions workflow compiles and publishes the APK to the android-latest GitHub Release. Server video rendering also requires the GitHub Actions secret described in the main README.
