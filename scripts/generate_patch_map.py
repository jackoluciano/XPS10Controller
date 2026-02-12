import json

import mido


TOTAL_PATCH = 1558


def main():
    print("Available MIDI inputs:")
    for name in mido.get_input_names():
        print(" -", name)

    port_name = input("\nType exact MIDI input name of XPS10: ").strip()

    print("\nSTART MAPPING")
    print("Set XPS-10 to pf001, then increment patch ONE BY ONE.")
    print("Do NOT skip any patch.")
    print("Press Ctrl+C to abort.\n")

    mapping = []
    last_cc0 = None
    last_cc32 = None
    counter = 0

    try:
        with mido.open_input(port_name) as port:
            for msg in port:
                if msg.type == "control_change":
                    if msg.control == 0:
                        last_cc0 = msg.value
                    elif msg.control == 32:
                        last_cc32 = msg.value

                elif msg.type == "program_change":
                    if last_cc0 is not None:
                        mapping.append(
                            {
                                "index": counter,
                                "bank_msb": last_cc0,
                                "bank_lsb": last_cc32 if last_cc32 is not None else 0,
                                "program": msg.program,
                            }
                        )

                        print(f"{counter:04d} → bank={last_cc0}, pc={msg.program}")
                        counter += 1

                        if counter >= TOTAL_PATCH:
                            break

    except KeyboardInterrupt:
        print("\nMapping aborted by user.")

    out_path = "engine/xps10_patch_map.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2)

    print(f"\nSaved {len(mapping)} patches to {out_path}")


if __name__ == "__main__":
    main()
