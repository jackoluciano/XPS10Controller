# XPS-10 Controller

Adalah controller untuk keyboard XPS-10 yang mengirim midi signal dari .apk HP ke XPS-10 lewat kabel OTG dan kabel USB to MIDI. README ini berisi: 

1) UI kontrol (HTML/CSS/JS)
2) Engine + build steps (Desktop Python + Android Capacitor)
3) Info versi toolchain (Java & Python)
4) Panduan download + setup dependencies (termasuk Android Studio)

## Struktur folder

- `main.py` — entrypoint Desktop (pywebview + bridge JS ke Python)
- `ui/` — HTML/CSS/JS untuk kontrol patch
- `engine/` — MIDI engine + `xps10_patch_map.json` untuk map masing-masing suara dengan midi valuenya masing-masing
- `scripts/` — util (contoh: generate patch map)
- `android/` — wrapper build Android (Capacitor)

## Versi yang dipakai / disarankan

- **Python**: 3.11.9 (Windows 64-bit)
- **Java / JDK**: 21
  - Android project hasil Capacitor memakai `sourceCompatibility JavaVersion.VERSION_21`.
  - Biasanya paling aman pakai **Embedded JDK 21** dari Android Studio.
- **Node.js**: LTS (disarankan Node 20+)
- **Android Studio**: versi stable terbaru + Android SDK

## Download

Opsi A (Git):

```bash
git clone <URL_REPO_INI>
cd xps10_github
```

Opsi B (ZIP):
- Download ZIP dari GitHub

## Desktop (Windows) — Run

Prereq:
- Install Python 3.11.x
- Pastikan XPS-10 sudah terdeteksi Windows (USB MIDI)

Install dependencies:

```bash
python -m pip install -r requirements.txt
```

Jalankan app:

```bash
python main.py
```

Di UI:
- Klik **Refresh** untuk list MIDI OUT
- Pilih port XPS-10
- Klik **Connect**
- Klik patch untuk mengirim program change

Catatan:
- Jika MIDI port tidak muncul, biasanya masalah driver/Windows atau `python-rtmidi` belum ke-install dengan benar.

## Generate patch map (opsional)

```bash
python scripts/generate_patch_map.py
```

Outputnya akan menulis ke `engine/xps10_patch_map.json`.

## Android (Capacitor) — Build APK

Catatan penting MIDI:
- Implementasi Android di repo ini memakai Web MIDI (`navigator.requestMIDIAccess`).
- Di banyak Android WebView, Web MIDI **tidak tersedia**, jadi APK bisa dibuild tapi MIDI akan error sampai ada native MIDI plugin.

### Prereq Android

Install:
- Node.js LTS
- Android Studio
- Android SDK (biarkan Android Studio yang install)
- Pastikan Android Studio memakai **JDK 21** (Settings → Build Tools → Gradle → Gradle JDK)

### Commands

Dari root:

```bash
cd android
npm install
npm run build
npm run cap:add
npm run cap:sync
npm run cap:open
```

Penjelasan singkat:
- `npm run build` membuat `android/www/` dari `../ui/` + `../engine/`
- `npm run cap:add` membuat native project di `android/android/`
- `npm run cap:open` membuka project di Android Studio

Kalau `cap:open` tidak menemukan Android Studio, kamu bisa set env var:

PowerShell (session saat ini):
```powershell
$env:CAPACITOR_ANDROID_STUDIO_PATH = "C:\Program Files\Android\Android Studio\bin\studio64.exe"
npm run cap:open
```

PowerShell (persist):
```powershell
setx CAPACITOR_ANDROID_STUDIO_PATH "C:\Program Files\Android\Android Studio\bin\studio64.exe"
```

Lalu di Android Studio:
- Build → Build Bundle(s)/APK(s) → Build APK(s)

## Repo hygiene

File `.gitignore` sudah disiapkan untuk menghindari:
- `__pycache__/`, `node_modules/`
- `android/www/` (hasil build)
- `android/android/` (hasil generate Capacitor)

Kalau kamu memilih untuk commit `android/android/` juga (biar orang lain tidak perlu `cap:add`), tinggal hapus baris ignore-nya.
