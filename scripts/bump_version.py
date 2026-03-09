#!/usr/bin/env python3
"""Bump version in manifest.json + create git tag.

Usage:
  python scripts/bump_version.py 1.0.6
  python scripts/bump_version.py patch      # auto-increment patch
  python scripts/bump_version.py minor      # auto-increment minor
  python scripts/bump_version.py major      # auto-increment major

After running, push the tag to trigger the release workflow:
  git push origin v<new_version>
"""
import json
import subprocess
import sys
from pathlib import Path

MANIFEST = Path(__file__).resolve().parent.parent / "custom_components" / "pik_outlet" / "manifest.json"


def current_version() -> str:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return data["version"]


def bump(v: str, part: str) -> str:
    major, minor, patch = (int(x) for x in v.split("."))
    if part == "patch":
        patch += 1
    elif part == "minor":
        minor += 1
        patch = 0
    elif part == "major":
        major += 1
        minor = 0
        patch = 0
    return f"{major}.{minor}.{patch}"


def set_version(new_ver: str) -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    data["version"] = new_ver
    MANIFEST.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def git_tag(ver: str) -> None:
    tag = f"v{ver}"
    subprocess.run(["git", "add", str(MANIFEST)], check=True)
    subprocess.run(["git", "commit", "-m", f"Bump version to {ver}"], check=True)
    subprocess.run(["git", "tag", "-a", tag, "-m", f"Release {ver}"], check=True)
    print(f"\nDone!  Tag: {tag}")
    print(f"Push with:  git push origin main {tag}")


def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    arg = sys.argv[1].strip().lower()
    cur = current_version()
    print(f"Current version: {cur}")

    if arg in ("patch", "minor", "major"):
        new_ver = bump(cur, arg)
    else:
        # Explicit version string
        parts = arg.lstrip("v").split(".")
        if len(parts) != 3 or not all(p.isdigit() for p in parts):
            print(f"Invalid version: {arg}")
            sys.exit(1)
        new_ver = arg.lstrip("v")

    print(f"New version:     {new_ver}")
    set_version(new_ver)
    git_tag(new_ver)


if __name__ == "__main__":
    main()
