import os
import sys
from pathlib import Path

import webview

from engine.midi_engine import XPSEngine


def resource_path(relative_path: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative_path


class Api:
    def __init__(self):
        patch_map_path = resource_path("engine/xps10_patch_map.json")
        self.engine = XPSEngine(str(patch_map_path))
        self.connected_port = None
        self.last_error = None

        # Try auto-connect on startup (optional)
        env_port = os.getenv("XPS10_MIDI_OUT")
        try:
            self.connected_port = self.engine.connect(env_port)
        except Exception as exc:
            self.last_error = str(exc)

    def get_status(self):
        return {
            "connected": self.connected_port is not None,
            "port": self.connected_port,
            "last_error": self.last_error,
        }

    def get_midi_outputs(self):
        return self.engine.list_output_ports()

    def connect_midi(self, port=None):
        self.connected_port = self.engine.connect(port)
        self.last_error = None
        return self.connected_port

    def send_patch(self, index: int):
        self.engine.send_patch(index)
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
