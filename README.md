# XPS-10 Controller (Desktop)

Adalah controller desktop untuk keyboard XPS-10 yang mengirim MIDI signal
melalui kabel USB MIDI. UI-nya HTML/CSS/JS, dibungkus dengan pywebview,
dan Python berkomunikasi dengan perangkat melalui mido + python-rtmidi.

## Structure

- `main.py` — app entrypoint (desktop window + JS bridge)
- `engine/` — MIDI engine + patch map JSON
- `ui/` — HTML/CSS/JS user interface
- `scripts/` — one-off utilities (e.g. generate patch map)

## Run

```bash
python -m pip install -r requirements.txt
python main.py
```

In the UI:
- Click **Refresh** to list MIDI outputs
- Choose the XPS-10 output port
- Click **Connect**
- Open **Bank** to save and load custom presets.
- **Save Preset?** stores the currently selected sound and its MIDI controls when
  the XPS-10 is connected. **Manually Adjust Preset** lets you choose a sound
  and edit its MIDI controls before saving.

Bank presets are stored per user in
`%USERPROFILE%\.xps10_controller\presets.json`. Presets store the selected
bank/program and these MIDI controls: modulation (CC1), pan (CC10),
expression (CC11), audio pad (CC16), hold (CC64), portamento (CC65),
resonance (CC71), release (CC72), attack (CC73), cutoff (CC74), reverb
(CC91), and chorus (CC93). Volume (CC7) is intentionally not stored.

The live MIDI monitor sends the original XPS-10 SysEx Data Request 1 (RQ1)
using Device ID `10H` and model ID `00 00 3A`, then parses the returned Data
Set 1 (DT1). This is how the monitor reads the current patch and stored utility
values even when the keyboard does not transmit a CC when a control is moved.
For Patch mode it requests Patch Common at address `1F 00 00 00` (size `50H`);
It first requests Setup at `01 00 00 00` (size `34H`) to determine the
current Sound Mode. In Patch mode it requests Patch Common at `1F 00 00 00`
(size `50H`) and all four Patch Tone blocks at `1F 00 20 00`, `1F 00 22 00`,
`1F 00 24 00`, and `1F 00 26 00` (each size `11AH`). In Performance mode it
requests Part 1 at `10 00 20 00` (size `31H`). This prevents the Performance
Part Level from being displayed as the Patch mode's physical master volume.
These are the fixed XPS-10 legacy blocks documented in the MIDI
implementation, not the address map used by the newer XPS-10X.
When a live CC is received, its value takes precedence over the periodic
SysEx snapshot, because the snapshot can contain the unchanged stored Part
value. Live CC values are cleared when a Program Change is received.
The XPS-10 also transmits realtime DT1 messages for panel edits. The engine
parses these one-byte updates directly at `1F 00 00 22` (cutoff), `1F 00 00
23` (resonance), `1F 00 00 24` (attack), `1F 00 00 25` (release), `1F 00 04
01` (chorus), `1F 00 06 01` (reverb), and `01 00 00 28` (audio pad volume).
These realtime messages take precedence over polled snapshots.
The XPS-10 has no user-facing Rx Exclusive toggle; its SysEx receiver is
available by default.

## Generate patch map (optional)

```bash
python scripts/generate_patch_map.py
```

It writes to `engine/xps10_patch_map.json`.

## Notes

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

- If MIDI ports don’t show up, make sure Windows sees the device and `python-rtmidi` is installed.
