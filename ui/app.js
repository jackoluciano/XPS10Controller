const PATCH_GROUPS = [
  ["Piano / EPiano", "Pf", 113],
  ["Organ / Keyboard", "Ky", 143],
  ["Strings / Guitar", "St", 154],
  ["Brass / Bass", "Bs", 234],
  ["Synth / Pad", "Sy", 492],
  ["World / Other", "Wr", 330],
  ["Drums / FX", "Dr", 92]
];

let ABS_PATCH_LIST = [];

for (const [_, prefix, count] of PATCH_GROUPS) {
  for (let i = 1; i <= count; i++) {
    ABS_PATCH_LIST.push(`${prefix}${String(i).padStart(3,"0")}`);
  }
}

// Desktop bridge (pywebview) → Python Engine
let api = null;
let midiOutputsEl = null;
let midiRefreshEl = null;
let midiConnectEl = null;

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function isDesktopApp() {
  return typeof window.pywebview !== "undefined" && window.pywebview.api;
}

async function initDesktopBridge() {
  if (!window.pywebview || !window.pywebview.api) {
    setStatus("Desktop bridge not available");
    return;
  }

  api = window.pywebview.api;

  midiOutputsEl = document.getElementById("midi-outputs");
  midiRefreshEl = document.getElementById("midi-refresh");
  midiConnectEl = document.getElementById("midi-connect");

  if (midiRefreshEl) {
    midiRefreshEl.onclick = () => refreshMidiOutputs();
  }
  if (midiConnectEl) {
    midiConnectEl.onclick = () => connectSelectedMidi();
  }

  await refreshMidiOutputs();

  try {
    const status = await api.get_status();
    if (status.connected) {
      setStatus(`Connected ✓ (${status.port})`);
      if (midiOutputsEl && status.port) {
        midiOutputsEl.value = status.port;
      }
      return;
    }
  } catch (e) {
    // ignore and try connect
  }

  try {
    const chosen = await api.connect_midi(null);
    setStatus(`Connected ✓ (${chosen})`);
    if (midiOutputsEl && chosen) {
      midiOutputsEl.value = chosen;
    }
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    setStatus(`MIDI not connected: ${msg}`);
  }
}

async function refreshMidiOutputs() {
  if (!api || !midiOutputsEl) return;

  try {
    const outputs = await api.get_midi_outputs();
    midiOutputsEl.innerHTML = "";

    if (!outputs || outputs.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(No MIDI outputs found)";
      midiOutputsEl.appendChild(opt);
      return;
    }

    for (const name of outputs) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      midiOutputsEl.appendChild(opt);
    }
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    setStatus(`Can't list MIDI outputs: ${msg}`);
  }
}

async function connectSelectedMidi() {
  if (!api) {
    setStatus("Not connected (run desktop app)");
    return;
  }

  const selected = midiOutputsEl ? midiOutputsEl.value : null;
  try {
    const chosen = await api.connect_midi(selected || null);
    setStatus(`Connected ✓ (${chosen})`);
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    setStatus(`MIDI not connected: ${msg}`);
  }
}

setStatus("Open via desktop EXE (pywebview)");
window.addEventListener("pywebviewready", () => {
  initDesktopBridge();
});

// ---------- UI BUILD ----------

const topBar = document.getElementById("top-bar");
const patchContainer = document.getElementById("patch-container");

PATCH_GROUPS.forEach((group, idx) => {
  const btn = document.createElement("button");
  btn.className = "group-btn";
  btn.innerText = group[0];
  btn.onclick = () => selectGroup(idx);
  topBar.appendChild(btn);
});

function selectGroup(index) {
  document.querySelectorAll(".group-btn").forEach(b => b.classList.remove("active"));
  topBar.children[index].classList.add("active");

  patchContainer.innerHTML = "";

  const start = PATCH_GROUPS.slice(0,index).reduce((s,g)=>s+g[2],0);
  const count = PATCH_GROUPS[index][2];

  const patches = ABS_PATCH_LIST.slice(start, start+count);

  patches.forEach((patch, i) => {
    const btn = document.createElement("button");
    btn.className = "patch-btn";
    btn.innerText = patch;
    btn.onclick = () => sendPatch(start + i, patch);
    patchContainer.appendChild(btn);
  });
}

function sendPatch(index, label) {
  if (!api) {
    setStatus("Not connected (run desktop app)");
    return;
  }

  api.send_patch(index)
    .then(() => setStatus(`✓ ${label}`))
    .catch((e) => {
      const msg = (e && e.message) ? e.message : String(e);
      setStatus(`Error: ${msg}`);
    });
}

// default load
selectGroup(0);
