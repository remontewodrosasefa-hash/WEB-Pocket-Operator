#!/usr/bin/env python3
"""Copy the local "PO ALL" Pocket Operator sample folders into samples/<pack>/<num>.wav
and (re)generate samples.json used by js/library.js.

Run from the project root:  python3 scripts/build-samples.py
"""
import os, json, wave, contextlib

SRC = "PO ALL"
OUT = "samples"

LEGEND = {
    "PO12": "PO-12 rhythm", "PO14": "PO-14 sub", "PO16": "PO-16 factory",
    "PO20": "PO-20 arcade", "PO24": "PO-24 office", "PO28": "PO-28 robot",
    "po128": "PO-128 Mega Man", "PO32": "PO-32 tonic", "PO33": "PO-33 K.O.!",
    "PO35": "PO-35 speak", "PO133": "PO-133 Street Fighter",
    "PO137": "PO-137 Rick and Morty",
}
# PO-33 first, then the other synth/drum PObs, then the collab units.
ORDER = ["PO33", "PO32", "PO35", "PO12", "PO14", "PO16",
         "PO20", "PO24", "PO28", "PO133", "PO137", "po128"]


def main():
    manifest = {"packs": []}
    for pack in ORDER:
        d = os.path.join(SRC, pack)
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.lower().endswith(".wav"))
        if not files:
            continue
        od = os.path.join(OUT, pack.lower())
        os.makedirs(od, exist_ok=True)
        entries = []
        for f in files:
            num = f.split()[0]
            dst = os.path.join(od, num + ".wav")
            if not os.path.exists(dst):
                with open(os.path.join(d, f), "rb") as a, open(dst, "wb") as b:
                    b.write(a.read())
            seconds = None
            try:
                with contextlib.closing(wave.open(dst, "rb")) as w:
                    seconds = round(w.getnframes() / w.getframerate(), 3)
            except Exception:
                pass
            entries.append({
                "id": f"{pack.lower()}/{num}",
                "num": num,
                "url": f"samples/{pack.lower()}/{num}.wav",
                "seconds": seconds,
            })
        manifest["packs"].append({
            "id": pack.lower(),
            "name": LEGEND.get(pack, pack),
            "count": len(entries),
            "samples": entries,
        })

    with open("samples.json", "w") as f:
        json.dump(manifest, f, indent=1)

    total = sum(p["count"] for p in manifest["packs"])
    print(f"wrote samples.json — {len(manifest['packs'])} packs, {total} samples")


if __name__ == "__main__":
    main()
