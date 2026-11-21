#!/usr/bin/env python3
"""Create a portable Docencia package from a verified Electron distribution."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
ELECTRON = "v45.4.1"
WEB = ("index.html", "attendance.css", "attendance.js", "periods.js", "Docencia.png")
DESKTOP = ("main.cjs", "preload.cjs", "store.cjs")


def download_runtime(platform, architecture, directory):
    filename = f"electron-{ELECTRON}-{platform}-{architecture}.zip"
    subprocess.run([
        "gh", "release", "download", ELECTRON, "--repo", "electron/electron",
        "--pattern", filename, "--pattern", "SHASUMS256.txt", "--dir", str(directory),
    ], check=True)
    sums = {}
    for line in (directory / "SHASUMS256.txt").read_text().splitlines():
        digest, name = line.split(maxsplit=1)
        sums[name.lstrip("*")] = digest
    archive = directory / filename
    digest = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual != sums.get(filename):
        raise RuntimeError(f"El checksum de {filename} no coincide.")
    return archive


def extract_runtime(archive, destination, platform):
    with ZipFile(archive) as source:
        for item in source.infolist():
            file = Path(source.extract(item, destination))
            if platform != "linux" or item.is_dir():
                continue
            permissions = item.external_attr >> 16
            if stat.S_ISLNK(permissions):
                target = file.read_text()
                file.unlink()
                file.symlink_to(target)
            elif permissions & 0o777:
                file.chmod(permissions & 0o777)
    original = destination / ("electron.exe" if platform == "win32" else "electron")
    executable = destination / ("Docencia.exe" if platform == "win32" else "docencia")
    original.rename(executable)


def add_docencia(destination):
    resources = destination / "resources"
    (resources / "default_app.asar").unlink(missing_ok=True)
    app = resources / "app"
    (app / "desktop").mkdir(parents=True)
    (app / "src").mkdir()
    shutil.copy2(ROOT / "desktop/package.json", app / "package.json")
    shutil.copy2(ROOT / "LICENSE", app / "LICENSE")
    for name in WEB:
        shutil.copy2(ROOT / "src" / name, app / "src" / name)
    for name in DESKTOP:
        shutil.copy2(ROOT / "desktop" / name, app / "desktop" / name)


def build(platform, architecture, output):
    platform_name = "Windows" if platform == "win32" else "Linux"
    version = json.loads((ROOT / "desktop/package.json").read_text())["version"]
    output.mkdir(parents=True, exist_ok=True)
    unpacked = output / "Docencia"
    with tempfile.TemporaryDirectory() as scratch:
        runtime = download_runtime(platform, architecture, Path(scratch))
        extract_runtime(runtime, unpacked, platform)
        add_docencia(unpacked)
    base = output / f"Docencia-{version}-{platform_name}-{architecture}"
    if platform == "win32":
        with ZipFile(str(base) + ".zip", "w", compression=ZIP_DEFLATED, compresslevel=4) as archive:
            for entry in sorted(unpacked.rglob("*")):
                if entry.is_file():
                    archive.write(entry, entry.relative_to(output).as_posix())
    else:
        with tarfile.open(str(base) + ".tar.gz", "w:gz", compresslevel=4) as archive:
            archive.add(unpacked, arcname="Docencia")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("platform", choices=["linux", "win32"])
    parser.add_argument("architecture", choices=["x64", "arm64"])
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.platform, args.architecture, args.output)
