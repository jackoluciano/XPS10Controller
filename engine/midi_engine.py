import json
import time
from typing import Optional

import mido

class XPSEngine:
    DEFAULT_CONTROLS = (
        (11, 64), (16, 64), (64, 64), (65, 64),
        (74, 64), (71, 64), (73, 64), (72, 64),
        (93, 64), (91, 64), (10, 64), (75, 64),
        (76, 0), (77, 0), (78, 0),
    )
    SYSEX_DEVICE_ID = 0x10
    LEGACY_MODEL_ID = (0x00, 0x00, 0x3A)
    PATCH_MODE_COMMON_ADDRESS = (0x1F, 0x00, 0x00, 0x00)
    PERFORMANCE_MODE_PART_1_ADDRESS = (0x10, 0x00, 0x20, 0x00)
    PERFORMANCE_MODE_PART_1_SIZE = 0x31
    PATCH_COMMON_SIZE = 0x50
    SETUP_ADDRESS = (0x01, 0x00, 0x00, 0x00)
    SETUP_SIZE = 0x34
    PATCH_TONE_SIZE = 0x11A
    PATCH_TONE_ADDRESSES = (
        (0x1F, 0x00, 0x20, 0x00),
        (0x1F, 0x00, 0x22, 0x00),
        (0x1F, 0x00, 0x24, 0x00),
        (0x1F, 0x00, 0x26, 0x00),
    )
    REALTIME_DT1_CONTROLS = {
        (0x1F, 0x00, 0x00, 0x22): "74",
        (0x1F, 0x00, 0x00, 0x23): "71",
        (0x1F, 0x00, 0x00, 0x24): "73",
        (0x1F, 0x00, 0x00, 0x25): "72",
        (0x1F, 0x00, 0x04, 0x01): "93",
        (0x1F, 0x00, 0x06, 0x01): "91",
        (0x01, 0x00, 0x00, 0x28): "16",
    }

    def __init__(self, json_path):
        with open(json_path) as f:
            self.patch_map = json.load(f)
        self.out = None
        self.in_port = None
        self.current_controls = {}
        self.current_bank_msb = None
        self.current_bank_lsb = None
        self.current_program = None
        self.monitor_controls = {}
        self.live_controls = set()
        self.accept_snapshot_controls = True
        self.monitor_pitch = None
        self.last_midi_message = None
        self.last_state_request = 0.0
        self.current_scene_part = None
        self.current_patch_name = None
        self.current_mode = None
        self.sysex_requests = 0
        self.sysex_replies = 0
        self.last_sysex = None
        self.last_sysex_error = None
        self.identity_requests = 0
        self.identity_replies = 0

    def _handle_input(self, message):
        self.last_midi_message = message.dict()
        if message.type == "sysex":
            self.last_sysex = list(message.data)
            if len(message.data) >= 5 and tuple(message.data[:4]) == (0x7E, 0x10, 0x06, 0x02):
                self.identity_replies += 1
            self._handle_dt1(message.data)
            return
        if message.type == "pitchwheel":
            self.monitor_pitch = message.pitch
            return
        if message.type == "control_change" and message.control == 0:
            self.current_bank_msb = message.value
        elif message.type == "control_change" and message.control == 32:
            self.current_bank_lsb = message.value
        elif message.type == "control_change":
            self.monitor_controls[str(message.control)] = message.value
            self.live_controls.add(str(message.control))
            if message.control not in (1, 5, 7):
                self.current_controls[str(message.control)] = message.value
        elif message.type == "program_change":
            self.current_controls = {}
            self.monitor_controls = {}
            self.live_controls.clear()
            self.accept_snapshot_controls = False
            self.current_program = message.program

    def _handle_dt1(self, data):
        if len(data) < 11:
            self.last_sysex_error = f"Too short ({len(data)} bytes)"
            return
        legacy_header = tuple(data[0:6]) == (0x41, self.SYSEX_DEVICE_ID, 0x00, 0x00, 0x3A, 0x12)
        xps10x_header = tuple(data[0:6]) == (0x41, 0x10, 0x01, 0x06, 0x09, 0x12)
        if not (legacy_header or xps10x_header):
            self.last_sysex_error = "Not an XPS-10 DT1 header"
            return
        address = tuple(data[6:10])
        payload = list(data[10:-1])
        realtime_control = self.REALTIME_DT1_CONTROLS.get(address)
        if realtime_control is not None and payload:
            self.monitor_controls[realtime_control] = payload[0]
            self.live_controls.add(realtime_control)
            if realtime_control not in ("1", "5", "7"):
                self.current_controls[realtime_control] = payload[0]
            self.sysex_replies += 1
            self.last_sysex_error = None
            return
        if address == self.SETUP_ADDRESS:
            if len(payload) < self.SETUP_SIZE:
                self.last_sysex_error = f"Unexpected setup size: {len(payload)} bytes"
                return
            self.current_mode = payload[0]
        elif address == self.PERFORMANCE_MODE_PART_1_ADDRESS:
            if len(payload) < self.PERFORMANCE_MODE_PART_1_SIZE:
                self.last_sysex_error = f"Unexpected performance part size: {len(payload)} bytes"
                return
            self._apply_performance_part(payload)
        elif address == self.PATCH_MODE_COMMON_ADDRESS:
            if len(payload) < self.PATCH_COMMON_SIZE:
                self.last_sysex_error = f"Unexpected patch common size: {len(payload)} bytes"
                return
            self.current_patch_name = bytes(payload[:12]).decode("ascii", errors="replace").rstrip()
        elif address in self.PATCH_TONE_ADDRESSES:
            if len(payload) < self.PATCH_TONE_SIZE:
                self.last_sysex_error = f"Unexpected patch tone size: {len(payload)} bytes"
                return
            if address == self.PATCH_TONE_ADDRESSES[0]:
                self._apply_patch_tone(payload)
        else:
            self.last_sysex_error = f"Unexpected address/size: {address}, {len(payload)} bytes"
            return
        self.sysex_replies += 1
        self.last_sysex_error = None

    def _apply_performance_part(self, payload):
        self.current_scene_part = payload
        self.current_bank_msb = payload[0x04]
        self.current_bank_lsb = payload[0x05]
        self.current_program = payload[0x06]
        snapshot_controls = {
            "7": payload[0x07],
            "10": payload[0x08],
            "65": payload[0x0E],
            "5": payload[0x0F],
            "74": payload[0x11],
            "71": payload[0x12],
            "73": payload[0x13],
            "72": payload[0x14],
            "75": payload[0x21],
            "76": payload[0x22],
            "77": payload[0x23],
            "78": payload[0x24],
            "93": payload[0x1D],
            "91": payload[0x1E],
        }
        if self.accept_snapshot_controls:
            self.monitor_controls.update({
                control: value
                for control, value in snapshot_controls.items()
                if control not in self.live_controls
            })
            self.current_controls.update({
                control: value
                for control, value in snapshot_controls.items()
                if control not in ("1", "5", "7") and control not in self.live_controls
            })

    def _apply_patch_tone(self, payload):
        snapshot_controls = {
            "7": payload[0x00],
            "93": payload[0x0F],
            "91": payload[0x10],
            "74": payload[0x49],
            "71": payload[0x4D],
            "73": payload[0x66],
            "72": payload[0x69],
        }
        if self.accept_snapshot_controls:
            self.monitor_controls.update({
                control: value
                for control, value in snapshot_controls.items()
                if control not in self.live_controls
            })
            self.current_controls.update({
                control: value
                for control, value in snapshot_controls.items()
                if control not in ("1", "5", "7") and control not in self.live_controls
            })

    @staticmethod
    def _checksum(values):
        return (128 - (sum(values) % 128)) % 128

    def request_current_state(self):
        if self.out is None:
            raise RuntimeError("MIDI output not connected. Call connect() first.")
        now = time.monotonic()
        if now - self.last_state_request < 0.5:
            return False
        self.out.send(mido.Message(
            "sysex",
            data=(0x7E, 0x7F, 0x06, 0x01),
        ))
        self.identity_requests += 1
        requests = (
            (self.SETUP_ADDRESS, self.SETUP_SIZE),
        )
        if self.current_mode == 1:
            requests += ((self.PERFORMANCE_MODE_PART_1_ADDRESS, self.PERFORMANCE_MODE_PART_1_SIZE),)
        else:
            requests += (
                (self.PATCH_MODE_COMMON_ADDRESS, self.PATCH_COMMON_SIZE),
                *(
                    (address, self.PATCH_TONE_SIZE)
                    for address in self.PATCH_TONE_ADDRESSES
                ),
            )
        for address, size_value in requests:
            size = [
                (size_value >> 24) & 0x7F,
                (size_value >> 16) & 0x7F,
                (size_value >> 8) & 0x7F,
                size_value & 0x7F,
            ]
            body = [0x41, self.SYSEX_DEVICE_ID, *self.LEGACY_MODEL_ID, 0x11, *address, *size]
            self.out.send(mido.Message(
                "sysex",
                data=(*body, self._checksum(body[6:]),),
            ))
            self.sysex_requests += 1
        self.last_state_request = now
        return True

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

    @staticmethod
    def is_xps10_port(port_name):
        normalized = port_name.lower().replace("-", "").replace(" ", "")
        return "xps10" in normalized

    def connect(self, port: Optional[str] = None, *, prefer_contains: str = "XPS10"):
        output_ports = self.list_output_ports()
        if not output_ports:
            raise RuntimeError(
                "No MIDI output ports found. Make sure your device is connected and drivers are installed."
            )

        chosen_port = port
        if not chosen_port:
            prefer_lower = (prefer_contains or "").lower()
            match = next(
                (
                    p
                    for p in output_ports
                    if (prefer_lower and prefer_lower in p.lower()) or self.is_xps10_port(p)
                ),
                None,
            )
            if not match:
                raise RuntimeError("XPS-10 MIDI output port not found. Select an XPS-10 port and connect.")
            chosen_port = match
        elif not self.is_xps10_port(chosen_port):
            raise RuntimeError(
                f"'{chosen_port}' is not an XPS-10 port. Select the MIDI output named XPS-10."
            )

        try:
            self.out = mido.open_output(chosen_port)
        except (OSError, IOError, SystemError) as exc:
            available = "\n".join(f" - {name}" for name in output_ports)
            raise RuntimeError(
                f"Failed to open MIDI output port '{chosen_port}'. Available outputs:\n{available}"
            ) from exc

        input_ports = mido.get_input_names()
        input_match = next(
            (name for name in input_ports if name.lower() == chosen_port.lower()),
            next((name for name in input_ports if self.is_xps10_port(name)), None),
        )
        if input_match:
            if self.in_port is not None:
                self.in_port.close()
            self.in_port = mido.open_input(input_match, callback=self._handle_input)

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
        self.out.send(mido.Message("control_change", control=1, value=0))
        self.out.send(mido.Message("control_change", control=5, value=0))
        self.out.send(mido.Message("pitchwheel", pitch=0))
        self.current_bank_msb = data["bank_msb"]
        self.current_bank_lsb = data["bank_lsb"]
        self.current_program = data["program"]
        self.current_controls = {}
        self.monitor_controls = {}
        self.live_controls.clear()
        self.accept_snapshot_controls = False

    def send_control(self, control: int, value: int):
        if self.out is None:
            raise RuntimeError("MIDI output not connected. Call connect() first.")
        if not isinstance(control, int) or not 0 <= control <= 127:
            raise ValueError("MIDI control must be an integer between 0 and 127.")
        if not isinstance(value, int) or not 0 <= value <= 127:
            raise ValueError("MIDI value must be an integer between 0 and 127.")
        self.out.send(mido.Message("control_change", control=control, value=value))
        self.monitor_controls[str(control)] = value
        self.live_controls.add(str(control))
        if control not in (1, 5, 7):
            self.current_controls[str(control)] = value

    def send_default_controls(self):
        if self.out is None:
            raise RuntimeError("MIDI output not connected. Call connect() first.")
        for control, value in self.DEFAULT_CONTROLS:
            self.out.send(mido.Message("control_change", control=control, value=value))
