#!/usr/bin/env python3
"""Merge new translation keys from build/content/keys_*.py into assets/js/i18n/*.js.

Each content module exposes KEYS = {"i18n.key": {"en": "...", "hi": "...", ...}}.
Existing keys are never overwritten, and dictionaries stay in parity.

    python3 tools/merge_keys.py            # write
    python3 tools/merge_keys.py --check    # report only
"""
from __future__ import annotations

import glob
import importlib.util
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
I18N = os.path.join(ROOT, "assets", "js", "i18n")
CONTENT = os.path.join(ROOT, "build", "content")
LOCALES = ["en", "es", "hi", "bn", "ar", "sw", "de", "ko", "tl", "fr", "zh-CN", "zh-TW"]


def load_content() -> dict:
    keys: dict = {}
    for path in sorted(glob.glob(os.path.join(CONTENT, "keys_*.py"))):
        spec = importlib.util.spec_from_file_location("m_" + os.path.basename(path)[:-3], path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        for k, v in getattr(mod, "KEYS", {}).items():
            keys[k] = v
    return keys


def existing_keys(src: str) -> set:
    return set(re.findall(r"^\s*'((?:[^'\\]|\\.)+)'\s*:", src, re.M))


def q(s: str) -> str:
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'"


def merge(path: str, code: str, keys: dict, write: bool) -> tuple[int, list]:
    src = open(path, encoding="utf-8").read()
    have = existing_keys(src)
    missing = []
    lines = []
    for k in sorted(keys):
        val = keys[k].get(code)
        if val is None:
            missing.append(k + " (no " + code + " translation supplied)")
            continue
        if k in have:
            continue
        lines.append(f"  {q(k)}: {q(val)}")
    if not lines:
        return 0, missing
    idx = src.rindex("\n};")
    head = src[:idx].rstrip()
    if not head.endswith(","):
        head += ","
    block = ("\n\n  /* ---- merged by tools/merge_keys.py ---- */\n"
             + ",\n".join(lines) + "\n")
    out = head + block + src[idx + 1:]
    if write:
        open(path, "w", encoding="utf-8").write(out)
    return len(lines), missing


def main() -> int:
    write = "--check" not in sys.argv
    keys = load_content()
    print(f"{len(keys)} keys in build/content")
    total_missing = 0
    for code in LOCALES:
        path = os.path.join(I18N, code + ".js")
        added, missing = merge(path, code, keys, write)
        total_missing += len(missing)
        print(f"  {code:<6} +{added:<4} {'WROTE' if write and added else ''} {('MISSING ' + str(len(missing))) if missing else ''}")
        for m in missing[:5]:
            print("        " + m)
    return 1 if total_missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
