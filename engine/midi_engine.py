import json
from typing import Optional

import mido

class XPSEngine:
    def __init__(self, json_path):
        with open(json_path) as f:
            self.patch_map = json.load(f)
        self.out = None

    @staticmethod
    def list_output_ports():
        try:
            return mido.get_output_names()
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "MIDI backend missing. Install 'python-rtmidi' (pip install python-rtmidi)."
            ) from exc
        except AttributeError as exc:
            raise RuntimeError(
                "Broken MIDI backend detected. If you installed the 'rtmidi' package, uninstall it and install "
                "'python-rtmidi' instead: pip uninstall rtmidi ; pip install python-rtmidi"
            ) from exc

    def connect(self, port: Optional[str] = None, *, prefer_contains: str = "XPS10"):
        output_ports = self.list_output_ports()
        if not output_ports:
            raise RuntimeError(
                "No MIDI output ports found. Make sure your device is connected and drivers are installed."
            )

        chosen_port = port
        if not chosen_port:
            prefer_lower = (prefer_contains or "").lower()
            match = next((p for p in output_ports if prefer_lower and prefer_lower in p.lower()), None)
            chosen_port = match or output_ports[0]

        try:
            self.out = mido.open_output(chosen_port)
        except (OSError, IOError) as exc:
            available = "\n".join(f" - {name}" for name in output_ports)
            raise RuntimeError(
                f"Failed to open MIDI output port '{chosen_port}'. Available outputs:\n{available}"
            ) from exc

        return chosen_port

    def send_patch(self, idx):
        if self.out is None:
            raise RuntimeError("MIDI output not connected. Call connect() first.")

        if not isinstance(idx, int):
            raise TypeError("Patch index must be an integer.")

        if idx < 0 or idx >= len(self.patch_map):
            raise IndexError(f"Patch index out of range: {idx} (0..{len(self.patch_map) - 1})")

        data = self.patch_map[idx]
        self.out.send(mido.Message('control_change', control=0, value=data["bank_msb"]))
        self.out.send(mido.Message('control_change', control=32, value=data["bank_lsb"]))
        self.out.send(mido.Message('program_change', program=data["program"]))
