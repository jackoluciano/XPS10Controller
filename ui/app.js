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
const MIDI_CONTROLS = [
  { control: 11, name: "Expression" },
  { control: 16, name: "Audio Pad" },
  { control: 64, name: "Hold" },
  { control: 65, name: "Portamento" },
  { control: 74, name: "Cutoff" },
  { control: 71, name: "Resonance" },
  { control: 73, name: "Attack" },
  { control: 72, name: "Release" },
  { control: 93, name: "Chorus" },
  { control: 91, name: "Reverb" },
  { control: 10, name: "Pan" },
  { control: 75, name: "Decay" },
  { control: 76, name: "Vibrato Rate" },
  { control: 77, name: "Vibrato Depth" },
  { control: 78, name: "Vibrato Delay" }
];
const DEFAULT_CONTROL_VALUE = 64;
const DEFAULT_VIBRATO_CONTROLS = new Set([76, 77, 78]);
const MONITOR_CONTROLS = [
  { control: 11, name: "Expression" },
  { control: 16, name: "Audio Pad" },
  { control: 64, name: "Hold" },
  { control: 65, name: "Portamento" },
  { control: 74, name: "Cutoff" },
  { control: 71, name: "Resonance" },
  { control: 73, name: "Attack" },
  { control: 72, name: "Release" },
  { control: 93, name: "Chorus" },
  { control: 91, name: "Reverb" },
  { control: 10, name: "Pan" }
];

for (const [_, prefix, count] of PATCH_GROUPS) {
  for (let i = 1; i <= count; i++) {
    ABS_PATCH_LIST.push(`${prefix}${String(i).padStart(3,"0")}`);
  }
}

// Browser Web MIDI bridge. The desktop build still uses pywebview through main.py.
let api = null;
let midiOutputsEl = null;
let midiRefreshEl = null;
let midiConnectEl = null;
let bankView = null;
let presets = [];
let bankMode = "use";
let xps10Connected = false;
let monitorTimer = null;
let selectedPatch = { index: 0, label: ABS_PATCH_LIST[0] };
let controlsResetOnPatch = false;
let lastPatchKey = null;
let patchOperation = Promise.resolve();
let presetOperationInProgress = false;
function createDefaultControlValues() {
  return Object.fromEntries(MIDI_CONTROLS.map(({ control }) => [
    control,
    DEFAULT_VIBRATO_CONTROLS.has(control) ? 0 : DEFAULT_CONTROL_VALUE
  ]));
}

let controlValues = createDefaultControlValues();

class WebMidiApi {
  constructor() {
    this.access = null;
    this.output = null;
    this.input = null;
    this.patchMap = [];
    this.state = {
      patch: null,
      patch_name: null,
      mode: null,
      controls: {},
      monitor_controls: {},
      monitor_pitch: null,
      last_midi_message: null,
      last_sysex: null,
      last_sysex_error: null
    };
    this.bankMsb = null;
    this.bankLsb = null;
    this.lastStateRequest = 0;
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      throw new Error("Browser ini tidak mendukung Web MIDI. Gunakan Chrome atau Edge.");
    }
    this.access = await navigator.requestMIDIAccess({ sysex: true });
    this.access.onstatechange = () => refreshMidiOutputs();
    const response = await fetch("engine/xps10_patch_map.json");
    if (!response.ok) throw new Error("Patch map tidak dapat dimuat.");
    this.patchMap = await response.json();
  }

  getOutputNames() {
    return Array.from(this.access.outputs.values()).map(port => port.name);
  }

  findPort(name, collection) {
    const ports = Array.from(collection.values());
    if (name) return ports.find(port => port.name === name);
    return ports.find(port => port.name.toLowerCase().replace(/[- ]/g, "").includes("xps10"));
  }

  async get_midi_outputs() {
    return this.getOutputNames();
  }

  async connect_midi(name = null) {
    const output = this.findPort(name, this.access.outputs);
    if (!output) throw new Error("Pilih port MIDI output XPS-10.");
    const input = this.findPort(output.name, this.access.inputs);
    this.output = output;
    this.input = input || null;
    if (this.input) this.input.onmidimessage = event => this.handleMessage(event.data);
    return output.name;
  }

  async get_status() {
    return {
      connected: Boolean(this.output),
      xps10_connected: Boolean(this.output && this.isXps10Port(this.output.name)),
      port: this.output ? this.output.name : null,
      last_error: null
    };
  }

  isXps10Port(name) {
    return name.toLowerCase().replace(/[- ]/g, "").includes("xps10");
  }

  requireOutput() {
    if (!this.output) throw new Error("MIDI belum tersambung. Pilih port lalu Connect.");
  }

  send(bytes) {
    this.requireOutput();
    this.output.send(bytes);
  }

  sendControl(control, value) {
    this.send([0xB0, control, value]);
    this.state.monitor_controls[String(control)] = value;
    if (![1, 5, 7].includes(control)) this.state.controls[String(control)] = value;
  }

  async send_control(control, value) {
    this.sendControl(Number(control), Number(value));
    return true;
  }

  async send_default_controls() {
    for (const [control, value] of [[11,64],[16,64],[64,64],[65,64],[74,64],[71,64],[73,64],[72,64],[93,64],[91,64],[10,64],[75,64],[76,0],[77,0],[78,0]]) {
      this.sendControl(control, value);
    }
    return true;
  }

  async send_patch(index) {
    const patch = this.patchMap[index];
    if (!patch) throw new Error(`Patch index tidak valid: ${index}`);
    this.send([0xB0, 0, patch.bank_msb]);
    this.send([0xB0, 32, patch.bank_lsb]);
    this.send([0xC0, patch.program]);
    this.send([0xB0, 1, 0]);
    this.send([0xB0, 5, 0]);
    this.send([0xE0, 0, 64]);
    this.state.patch = { index, patch_label: ABS_PATCH_LIST[index] };
    this.state.patch_name = null;
    this.state.controls = {};
    this.state.monitor_controls = {};
    return true;
  }

  checksum(values) {
    return (128 - (values.reduce((sum, value) => sum + value, 0) % 128)) % 128;
  }

  request(address, size) {
    const sizeBytes = [(size >> 24) & 0x7F, (size >> 16) & 0x7F, (size >> 8) & 0x7F, size & 0x7F];
    const body = [0x41, 0x10, 0x00, 0x00, 0x3A, 0x11, ...address, ...sizeBytes];
    this.send([0xF0, ...body, this.checksum(body.slice(6)), 0xF7]);
  }

  async get_current_state() {
    this.requireOutput();
    const now = performance.now();
    if (now - this.lastStateRequest > 500) {
      this.send([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]);
      this.request([1, 0, 0, 0], 0x34);
      if (this.state.mode === 1) {
        this.request([0x10, 0, 0x20, 0], 0x31);
      } else {
        this.request([0x1F, 0, 0, 0], 0x50);
        for (const address of [[0x1F,0,0x20,0],[0x1F,0,0x22,0],[0x1F,0,0x24,0],[0x1F,0,0x26,0]]) {
          this.request(address, 0x11A);
        }
      }
      this.lastStateRequest = now;
    }
    return this.state;
  }

  handleMessage(data) {
    const bytes = Array.from(data);
    const status = bytes[0] & 0xF0;
    const channelData = bytes.slice(1);
    this.state.last_midi_message = bytes;
    if (status === 0xB0 && channelData.length >= 2) {
      const [control, value] = channelData;
      if (control === 0) this.bankMsb = value;
      if (control === 32) this.bankLsb = value;
      if (control !== 0 && control !== 32) this.state.monitor_controls[String(control)] = value;
      if (![1, 5, 7, 0, 32].includes(control)) this.state.controls[String(control)] = value;
      return;
    }
    if (status === 0xC0 && channelData.length) {
      this.state.controls = {};
      this.state.monitor_controls = {};
      const patchIndex = this.patchMap.findIndex(item =>
        item.program === channelData[0]
        && (this.bankMsb === null || item.bank_msb === this.bankMsb)
        && (this.bankLsb === null || item.bank_lsb === this.bankLsb)
      );
      this.state.patch = patchIndex >= 0
        ? { index: patchIndex, patch_label: ABS_PATCH_LIST[patchIndex] }
        : null;
      return;
    }
    if (status === 0xE0 && channelData.length >= 2) {
      this.state.monitor_pitch = ((channelData[1] << 7) | channelData[0]) - 8192;
      return;
    }
    if (bytes[0] === 0xF0) this.handleSysEx(bytes);
  }

  handleSysEx(bytes) {
    this.state.last_sysex = bytes;
    if (bytes.length < 12 || bytes[1] !== 0x41 || bytes[5] !== 0x12) return;
    const address = bytes.slice(6, 10);
    const payload = bytes.slice(10, -2);
    if (address.join(",") === "1,0,0,0" && payload.length) {
      this.state.mode = payload[0];
    } else if (address.join(",") === "31,0,0,0" && payload.length >= 12) {
      this.state.patch_name = new TextDecoder().decode(new Uint8Array(payload.slice(0, 12))).trim();
    } else if (address.join(",") === "16,0,32,0" && payload.length >= 7) {
      const patch = this.patchMap.findIndex(item => item.program === payload[6]);
      if (patch >= 0) this.state.patch = { index: patch, patch_label: ABS_PATCH_LIST[patch] };
      this.state.monitor_controls["10"] = payload[8];
      this.state.monitor_controls["65"] = payload[14];
      this.state.monitor_controls["74"] = payload[17];
      this.state.monitor_controls["71"] = payload[18];
      this.state.monitor_controls["73"] = payload[19];
      this.state.monitor_controls["72"] = payload[20];
      this.state.monitor_controls["93"] = payload[29];
      this.state.monitor_controls["91"] = payload[30];
    } else if (address.join(",") === "31,0,32,0" && payload.length >= 0x6A) {
      this.state.monitor_controls["93"] = payload[15];
      this.state.monitor_controls["91"] = payload[16];
      this.state.monitor_controls["74"] = payload[0x49];
      this.state.monitor_controls["71"] = payload[0x4D];
      this.state.monitor_controls["73"] = payload[0x66];
      this.state.monitor_controls["72"] = payload[0x69];
    }
  }

  async get_presets() {
    return JSON.parse(localStorage.getItem("xps10-presets") || "[]");
  }

  async save_preset(preset) {
    const saved = { ...preset, id: preset.id || crypto.randomUUID(), name: String(preset.name || "Saved Sound").trim() };
    const all = await this.get_presets();
    const next = all.filter(item => item.id !== saved.id);
    next.push(saved);
    localStorage.setItem("xps10-presets", JSON.stringify(next));
    return saved;
  }

  async delete_preset(id) {
    const all = await this.get_presets();
    localStorage.setItem("xps10-presets", JSON.stringify(all.filter(item => item.id !== id)));
    return true;
  }
}

function patchKey(patch) {
  return patch && patch.index !== null ? String(patch.index) : null;
}

function updateControlInputs() {
  document.querySelectorAll(".midi-control").forEach(input => {
    const control = Number(input.dataset.control);
    input.value = controlValues[control];
    document.getElementById(`value-${control}`).value = controlValues[control];
  });
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function initWebMidi() {
  midiOutputsEl = document.getElementById("midi-outputs");
  midiRefreshEl = document.getElementById("midi-refresh");
  midiConnectEl = document.getElementById("midi-connect");
  bankView = document.getElementById("bank-view");
  try {
    api = new WebMidiApi();
    await api.init();
    await refreshMidiOutputs();
    setStatus("Web MIDI siap. Pilih port XPS-10 lalu klik Connect.");
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    setStatus(`Web MIDI tidak tersedia: ${msg}`);
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
    const xps10Option = Array.from(midiOutputsEl.options).find(option =>
      option.value.toLowerCase().replace(/[- ]/g, "").includes("xps10")
    );
    if (xps10Option) midiOutputsEl.value = xps10Option.value;
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
    xps10Connected = Boolean(chosen && (await api.get_status()).xps10_connected);
    setStatus(`${xps10Connected ? "Connected to XPS-10" : "Connected (not XPS-10)"} ✓ (${chosen})`);
    if (xps10Connected) startMonitor();
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    setStatus(`MIDI not connected: ${msg}`);
  }
}

setStatus("Web MIDI belum diinisialisasi");

// ---------- UI BUILD ----------

const topBar = document.getElementById("top-bar");
const patchContainer = document.getElementById("patch-container");
bankView = document.getElementById("bank-view");

PATCH_GROUPS.forEach((group, idx) => {
  const btn = document.createElement("button");
  btn.className = "group-btn";
  btn.innerText = group[0];
  btn.onclick = () => selectGroup(idx);
  topBar.appendChild(btn);
});

const bankButton = document.createElement("button");
bankButton.className = "group-btn";
bankButton.innerText = "Bank";
bankButton.onclick = () => showBank();
topBar.appendChild(bankButton);

function selectGroup(index) {
  bankView.hidden = true;
  patchContainer.hidden = false;
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

function queuePatchOperation(operation) {
  const result = patchOperation.then(operation);
  patchOperation = result.catch(() => {});
  return result;
}

async function sendPatchNow(index, label) {
  if (!api) {
    setStatus("Not connected (run desktop app)");
    return false;
  }

  await api.send_patch(index);
  await api.send_default_controls();
  selectedPatch = { index, label };
  controlValues = createDefaultControlValues();
  controlsResetOnPatch = true;
  lastPatchKey = String(index);
  updateControlInputs();
  setStatus(`✓ ${label}`);
  return true;
}

function sendPatch(index, label) {
  return queuePatchOperation(async () => {
    try {
      return await sendPatchNow(index, label);
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      setStatus(`Error: ${msg}`);
      return false;
    }
  });
}

function isConnected() {
  return Boolean(api && xps10Connected);
}

function startMonitor() {
  if (monitorTimer || !api) return;
  updateMonitor();
  monitorTimer = window.setInterval(updateMonitor, 250);
}

async function updateMonitor() {
  if (!api || !xps10Connected || !api.get_current_state) return;
  try {
    const state = await api.get_current_state();
    const currentPatchKey = patchKey(state.patch);
    if (
      currentPatchKey
      && currentPatchKey !== lastPatchKey
      && !presetOperationInProgress
    ) {
      await api.send_default_controls();
      controlValues = createDefaultControlValues();
      controlsResetOnPatch = true;
      updateControlInputs();
    }
    if (currentPatchKey) {
      lastPatchKey = currentPatchKey;
      selectedPatch = state.patch;
    }
    const patchText = document.getElementById("monitor-patch");
    const controlsEl = document.getElementById("monitor-controls");
    if (!patchText || !controlsEl) return;
    patchText.textContent = state.patch
      ? `Current sound: ${state.patch.patch_label}`
      : "Current sound: Waiting for Program Change";
    renderMonitorControls(state.monitor_controls || {});
    patchText.title = "";
  } catch (error) {
    setStatus(`Monitor error: ${error.message || error}`);
  }
}

async function loadPresets() {
  if (api) {
    presets = await api.get_presets();
  } else {
    try {
      presets = JSON.parse(localStorage.getItem("xps10-presets") || "[]");
    } catch (e) {
      presets = [];
    }

  }
}

async function syncCurrentState() {
  if (!api || !isConnected() || !api.get_current_state) return;
  const state = await api.get_current_state();
  const currentPatchKey = patchKey(state.patch);
  if (currentPatchKey && lastPatchKey && currentPatchKey !== lastPatchKey) {
    controlsResetOnPatch = true;
  }
  if (controlsResetOnPatch) {
    controlValues = createDefaultControlValues();
    controlsResetOnPatch = false;
    updateControlInputs();
  } else {
    controlValues = Object.fromEntries(MIDI_CONTROLS.map(({ control }) => {
      const key = String(control);
      const hasValue = state.controls && Object.prototype.hasOwnProperty.call(state.controls, key);
      return [
        control,
        DEFAULT_VIBRATO_CONTROLS.has(control)
          ? (controlValues[control] ?? 0)
          : (hasValue ? Number(state.controls[key]) : DEFAULT_CONTROL_VALUE)
      ];
    }));
  }
  if (state.patch) {
    selectedPatch = state.patch;
    lastPatchKey = currentPatchKey;
  }
  return state;
}

function patchOptions() {
  return ABS_PATCH_LIST.map((patch, index) =>
    `<option value="${index}" ${index === selectedPatch.index ? "selected" : ""}>${patch}</option>`
  ).join("");
}

function renderBank() {
  if (!bankView || bankView.hidden) return;
  const emptyMessage = presets.length === 0
    ? '<p class="muted bank-empty">Belum ada preset terdaftar</p>'
    : "";
  bankView.innerHTML = `
    <section class="bank-header">
      <div>
        ${emptyMessage}
        ${bankMode === "edit" ? '<p class="mode-hint">Mode Edit aktif: pilih sound yang mau diedit</p>' : ""}
        ${bankMode === "delete" ? '<p class="mode-hint">Mode Delete aktif: pilih sound yang mau dihapus</p>' : ""}
      </div>
      <div class="bank-actions">
        <button id="add-preset" class="primary-btn" type="button">Add New Sound</button>
        <button id="edit-mode" class="small-btn ${bankMode === "edit" ? "is-active" : ""}" type="button" aria-pressed="${bankMode === "edit"}">Edit Sound</button>
        <button id="delete-mode" class="small-btn danger-btn ${bankMode === "delete" ? "is-active" : ""}" type="button" aria-pressed="${bankMode === "delete"}">Delete Sound</button>
      </div>
    </section>
    <div id="preset-list" class="preset-list mode-${bankMode}">
      ${presets.map(preset => `
        <article class="preset-card ${bankMode !== "use" ? "selectable-card" : ""}" data-id="${escapeHtml(preset.id)}">
          <button class="preset-tile" type="button">${escapeHtml(preset.name || "Saved Sound")}</button>
        </article>
      `).join("")}
    </div>
  `;
  bankView.onclick = (event) => {
    const target = event.target.closest("button, .preset-card");
    if (!target || !bankView.contains(target)) return;
    if (target.id === "add-preset") return showAddPreset();
    if (target.id === "edit-mode") {
      bankMode = bankMode === "edit" ? "use" : "edit";
      renderBank();
      return;
    }
    if (target.id === "delete-mode") {
      bankMode = bankMode === "delete" ? "use" : "delete";
      renderBank();
      return;
    }
    const card = target.closest(".preset-card");
    if (!card) return;
    if (bankMode === "edit") editPreset(card.dataset.id);
    else if (bankMode === "delete") deletePreset(card.dataset.id);
    else loadPreset(card.dataset.id);
  };
}

function showBank() {
  document.querySelectorAll(".group-btn").forEach(button => button.classList.remove("active"));
  bankButton.classList.add("active");
  bankMode = "use";
  patchContainer.hidden = true;
  bankView.hidden = false;
  loadPresets().then(renderBank).catch(showError);
}

function showAddPreset() {
  bankView.innerHTML = `
    <section class="editor-card">
      <button id="back-to-bank" class="text-btn" type="button">← Back to Bank</button>
      <h2>Add New Sound</h2>
      <p class="muted">${isConnected() ? "Pilih cara membuat preset." : "XPS-10 belum tersambung, preset akan dibuat secara manual."}</p>
      <div class="choice-grid">
        ${isConnected() ? '<button id="save-current" class="choice-btn" type="button"><strong>Save Preset?</strong><span>Simpan preset yang sedang ditampilkan sekarang</span></button>' : ""}
        <button id="manual-adjust" class="choice-btn" type="button"><strong>Manually Adjust Preset</strong><span>Pilih suara lalu atur parameter MIDI secara manual</span></button>
      </div>
    </section>
  `;
  document.getElementById("back-to-bank").onclick = showBank;
  const saveCurrent = document.getElementById("save-current");
  if (saveCurrent) saveCurrent.onclick = saveCurrentPreset;
  document.getElementById("manual-adjust").onclick = () => showPresetForm(false);
}

function showPresetForm(saveCurrent, existingPreset = null) {
  bankView.innerHTML = `
    <section class="editor-card">
      <button id="back-to-bank" class="text-btn" type="button">← Back to Bank</button>
      <h2>${saveCurrent ? "Save Preset?" : "Manually Adjust Preset"}</h2>
      <label class="field-label">Nama preset<input id="preset-name" type="text" maxlength="80" value="${escapeHtml(existingPreset ? existingPreset.name : "")}" placeholder="Contoh: Warm Pad"></label>
      ${saveCurrent ? `<p class="current-patch">Suara aktif: <strong>${escapeHtml(selectedPatch.label)}</strong></p>` : `
        <label class="field-label">Pilih suara dari Main Menu<select id="manual-patch">${patchOptions()}</select></label>
      `}
      <div class="control-grid">
        ${MIDI_CONTROLS.map(({ control, name }) => `
          <label class="control-field"><span class="control-name">${name}</span><output id="value-${control}">${controlValues[control]}</output>
            <input class="midi-control" data-control="${control}" type="range" min="0" max="127" value="${controlValues[control]}">
          </label>
        `).join("")}
      </div>
      <button id="save-preset" class="primary-btn" type="button">Save Preset</button>
    </section>
  `;
  document.getElementById("back-to-bank").onclick = showBank;
  const manualPatch = document.getElementById("manual-patch");
  if (manualPatch) {
    manualPatch.onchange = async () => {
      const index = Number(manualPatch.value);
      await sendPatch(index, ABS_PATCH_LIST[index]);
      showPresetForm(false);
    };
  }
  document.querySelectorAll(".midi-control").forEach(input => {
    input.oninput = async () => {
      const control = Number(input.dataset.control);
      const value = Number(input.value);
      controlValues[control] = value;
      document.getElementById(`value-${control}`).value = value;
      if (api && isConnected()) await api.send_control(control, value);
    };
  });
  document.getElementById("save-preset").onclick = () => savePreset(saveCurrent, existingPreset);
}

function renderMonitorControls(values = {}) {
  const controlsEl = document.getElementById("monitor-controls");
  if (!controlsEl) return;
  controlsEl.innerHTML = MONITOR_CONTROLS.map(({ control, name }) => {
    const has = Object.prototype.hasOwnProperty.call(values, String(control));
    const raw = has ? Number(values[String(control)]) : null;
    const pct = has ? Math.round((raw / 127) * 100) : 0;
    return `<div class="monitor-value ${has ? "" : "is-empty"}" style="--pct:${pct}%">
      <span class="monitor-name">${name}</span>
      <span class="monitor-num">${has ? raw : "—"}</span>
      <i class="monitor-bar"></i>
    </div>`;
  }).join("");
}

async function saveCurrentPreset() {
  try {
    const state = await syncCurrentState();
    if (!state || !state.patch || state.patch.index === null) {
      throw new Error("Belum menerima patch dari MIDI input XPS-10. Pilih suara di XPS-10 lalu coba lagi.");
    }
    const preset = {
      patch_index: state.patch.index,
      patch_label: state.patch_name || state.patch.patch_label,
      controls: controlValues
    };
    const saved = await api.save_preset(preset);
    presets = [...presets, saved];
    setStatus(`Preset ${saved.name} berhasil disimpan`);
    showBank();
  } catch (e) {
    showError(e);
  }
}

async function savePreset(saveCurrent, existingPreset = null) {
  const name = document.getElementById("preset-name").value.trim();
  if (!name) {
    setStatus("Nama preset wajib diisi");
    return;
  }

  const preset = {
    id: existingPreset ? existingPreset.id : undefined,
    name,
    patch_index: selectedPatch.index,
    patch_label: selectedPatch.label,
    controls: controlValues
  };
  try {
    if (api) {
      const saved = await api.save_preset(preset);
      presets = existingPreset
        ? presets.map(item => item.id === saved.id ? saved : item)
        : [...presets, saved];
    } else {
      presets.push({ ...preset, id: crypto.randomUUID() });
      localStorage.setItem("xps10-presets", JSON.stringify(presets));
    }
    setStatus("Preset berhasil disimpan");
    bankMode = "use";
    showBank();
  } catch (e) {
    showError(e);
  }
}

async function loadPreset(id) {
  const preset = presets.find(item => item.id === id);
  if (!preset) return;
  return queuePatchOperation(async () => {
    presetOperationInProgress = true;
    try {
      if (!await sendPatchNow(preset.patch_index, preset.patch_label)) return;
      for (const [control, value] of Object.entries(preset.controls)) {
        if ([1, 5, 7].includes(Number(control))) continue;
        controlValues[control] = value;
        if (api && isConnected()) await api.send_control(Number(control), value);
      }
      setStatus(`✓ ${preset.name}`);
    } catch (e) {
      showError(e);
    } finally {
      presetOperationInProgress = false;
    }
  });
}

function editPreset(id) {
  const preset = presets.find(item => item.id === id);
  if (!preset) return;
  selectedPatch = { index: preset.patch_index, label: preset.patch_label };
  controlValues = { ...controlValues, ...preset.controls };
  showPresetForm(false, preset);
}

async function deletePreset(id) {
  const preset = presets.find(item => item.id === id);
  if (!preset || !window.confirm(`Delete ${preset.name}?`)) return;
  try {
    if (api) await api.delete_preset(id);
    presets = presets.filter(item => item.id !== id);
    bankMode = "use";
    renderBank();
    setStatus(`${preset.name} dihapus`);
  } catch (e) {
    showError(e);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function showError(error) {
  const msg = error && error.message ? error.message : String(error);
  setStatus(`Error: ${msg}`);
}

renderMonitorControls();

// default load
selectGroup(0);
if (midiRefreshEl) midiRefreshEl.onclick = () => refreshMidiOutputs();
if (midiConnectEl) midiConnectEl.onclick = () => connectSelectedMidi();
initWebMidi();
