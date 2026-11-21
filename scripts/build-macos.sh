#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
architecture="${1:-$(uname -m)}"
case "$architecture" in
  arm64|x86_64) targets=("$architecture") ;;
  universal) targets=(arm64 x86_64) ;;
  *) printf 'Uso: %s [arm64|x86_64|universal]\n' "$0" >&2; exit 2 ;;
esac

src="$root/src"
build="$root/build"
bundle="$build/Docencia.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources" "$build/module-cache"
cp "$src/Info.plist" "$bundle/Contents/Info.plist"
for resource in index.html periods.js attendance.js attendance.css Docencia.png Docencia.icns; do
  cp "$src/$resource" "$bundle/Contents/Resources/$resource"
done

binaries=()
for target in "${targets[@]}"; do
  binary="$build/Docencia-$target"
  xcrun --sdk macosx swiftc -target "$target-apple-macos15.0" -O \
    -module-cache-path "$build/module-cache" "$src/Docencia.swift" -o "$binary"
  binaries+=("$binary")
done
xcrun lipo -create "${binaries[@]}" -output "$bundle/Contents/MacOS/Docencia"
codesign --force --sign - "$bundle"
codesign --verify --strict "$bundle"
printf '%s\n' "$bundle"
