import os
import sys
import json
from pathlib import Path

import webview

from engine.midi_engine import XPSEngine


DEFAULT_PRESET_CONTROLS = (
    "11", "16", "64", "65", "74", "71", "73", "72",
    "93", "91", "10", "75",
)


def resource_path(relative_path: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative_path


class Api:
    def __init__(self):
        patch_map_path = resource_path("engine/xps10_patch_map.json")
        self.engine = XPSEngine(str(patch_map_path))
        self.connected_port = None
        self.last_error = None
        self.preset_path = Path.home() / ".xps10_controller" / "presets.json"
        self.presets = self._load_presets()

        # Try auto-connect on startup (optional)
        env_port = os.getenv("XPS10_MIDI_OUT")
        try:
            self.connected_port = self.engine.connect(env_port)
        except Exception as exc:
            self.last_error = str(exc)

    def _load_presets(self):
        try:
            if not self.preset_path.exists():
                return []
            with self.preset_path.open(encoding="utf-8") as preset_file:
                presets = json.load(preset_file)
            if not isinstance(presets, list):
                raise ValueError("Preset file must contain a list.")
            return presets
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            self.last_error = f"Could not load presets: {exc}"
            return []

    def _save_presets(self):
        try:
            self.preset_path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = self.preset_path.with_suffix(".tmp")
            with temporary_path.open("w", encoding="utf-8") as preset_file:
                json.dump(self.presets, preset_file, indent=2)
            temporary_path.replace(self.preset_path)
        except OSError as exc:
            raise RuntimeError(f"Could not save presets: {exc}") from exc

    def get_status(self):
        return {
            "connected": self.connected_port is not None,
            "xps10_connected": bool(
                self.connected_port and self.engine.is_xps10_port(self.connected_port)
            ),
            "port": self.connected_port,
            "last_error": self.last_error,
        }

    def get_midi_outputs(self):
        return self.engine.list_output_ports()

    def connect_midi(self, port=None):
        self.connected_port = self.engine.connect(port)
        self.last_error = None
        return self.connected_port

    def get_current_state(self):
        self.engine.request_current_state()
        patch = None
        if self.engine.current_program is not None:
            for index, item in enumerate(self.engine.patch_map):
                if (
                    item["program"] == self.engine.current_program
                    and item["bank_msb"] == self.engine.current_bank_msb
                    and item["bank_lsb"] == self.engine.current_bank_lsb
                ):
                    patch = {"index": index, "patch_label": self._patch_label(index)}
                    break
        if patch is None and self.engine.current_program is not None:
            patch = {
                "index": None,
                "patch_label": (
                    f"Bank {self.engine.current_bank_msb:03d}/"
                    f"{self.engine.current_bank_lsb:03d} "
                    f"PC {self.engine.current_program + 1:03d}"
                ),
            }
        return {
            "patch": patch,
            "patch_name": self.engine.current_patch_name,
            "mode": self.engine.current_mode,
            "controls": self.engine.current_controls,
            "monitor_controls": self.engine.monitor_controls,
            "monitor_pitch": self.engine.monitor_pitch,
            "last_midi_message": self.engine.last_midi_message,
            "sysex_requests": self.engine.sysex_requests,
            "sysex_replies": self.engine.sysex_replies,
            "last_sysex": self.engine.last_sysex,
            "last_sysex_error": self.engine.last_sysex_error,
            "identity_requests": self.engine.identity_requests,
            "identity_replies": self.engine.identity_replies,
        }

    @staticmethod
    def _patch_label(index):
        groups = [
            ("Pf", 113), ("Ky", 143), ("St", 154), ("Bs", 234),
            ("Sy", 492), ("Wr", 330), ("Dr", 92),
        ]
        offset = 0
        for prefix, count in groups:
            if index < offset + count:
                return f"{prefix}{index - offset + 1:03d}"
            offset += count
        return f"Patch {index + 1}"

    def send_patch(self, index: int):
        self.engine.send_patch(index)
        return True

    def send_control(self, control: int, value: int):
        self.engine.send_control(control, value)
        return True

    def send_default_controls(self):
        self.engine.send_default_controls()
        return True

    def get_presets(self):
        return self.presets

    def save_preset(self, preset):
        if not isinstance(preset, dict):
            raise ValueError("Preset must be an object.")
        name = str(preset.get("name", "")).strip() or self._next_preset_name()
        controls = preset.get("controls")
        if not isinstance(controls, dict):
            raise ValueError("Preset controls are required.")
        normalized_controls = {
            control: 64
            for control in DEFAULT_PRESET_CONTROLS
        }
        for control, value in controls.items():
            midi_control = int(control)
            midi_value = int(value)
            if midi_control in (1, 5, 7):
                continue
            if not 0 <= midi_control <= 127 or not 0 <= midi_value <= 127:
                raise ValueError("Preset MIDI values must be between 0 and 127.")
            normalized_controls[str(midi_control)] = midi_value
        saved = {
            "id": str(preset.get("id") or os.urandom(8).hex()),
            "name": name,
            "patch_index": int(preset.get("patch_index", 0)),
            "patch_label": str(preset.get("patch_label", "")),
            "controls": normalized_controls,
        }
        self.presets = [item for item in self.presets if item.get("id") != saved["id"]]
        self.presets.append(saved)
        self._save_presets()
        return saved

    def _next_preset_name(self):
        used = {str(item.get("name", "")).lower() for item in self.presets}
        number = 1
        while f"saved{number:02d}".lower() in used:
            number += 1
        return f"saved{number:02d}"

    def delete_preset(self, preset_id):
        self.presets = [item for item in self.presets if item.get("id") != preset_id]
        self._save_presets()
        return True


def main():
    ui_dir = resource_path("ui")
    index_html = ui_dir / "index.html"

    api = Api()

    window = webview.create_window(
        "XPS-10 Controller",
        url=str(index_html),
        js_api=api,
        width=1100,
        height=700,
    )

    webview.start(debug=False)


if __name__ == "__main__":
    main()
