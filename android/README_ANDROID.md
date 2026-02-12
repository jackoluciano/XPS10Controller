# Android (Capacitor)

This folder is an Android-ready version of the XPS-10 Controller UI, with a JavaScript MIDI backend.

## What works

- UI runs inside Android WebView (Capacitor)
- Patch map is loaded from `engine/xps10_patch_map.json`

## Important note about MIDI

This implementation uses **Web MIDI** (`navigator.requestMIDIAccess`). Most Android WebViews **do not expose Web MIDI**, so:

- The APK can be built and installed
- MIDI sending will show an error until a **native Android MIDI plugin** is added (USB-MIDI via OTG or BLE-MIDI)

If you want, I can add a Capacitor plugin skeleton for Android MIDI next.

## Build APK (Windows)

Prereqs:
- Node.js LTS
- Android Studio + Android SDK
- Java 17

Commands:

```bash
cd android
npm install
npm run build
npm run cap:add
npm run cap:sync
npm run cap:open
```

If `npm run cap:open` says it can't find Android Studio, either:

- Open Android Studio manually and select the project folder: `android/android` (relative to this folder)
- Or set the env var so Capacitor can launch it:

	PowerShell (current session):
	```powershell
	$env:CAPACITOR_ANDROID_STUDIO_PATH = "C:\Program Files\Android\Android Studio\bin\studio64.exe"
	npm run cap:open
	```

	PowerShell (persist):
	```powershell
	setx CAPACITOR_ANDROID_STUDIO_PATH "C:\Program Files\Android\Android Studio\bin\studio64.exe"
	```

	Then restart the terminal.

Then in Android Studio:
- Build > Build Bundle(s)/APK(s) > Build APK(s)

For debug install:
- Run from Android Studio or use `adb install` on the generated APK.
