#!/bin/zsh
set -euo pipefail

PROJECT="${0:A:h:h}"
VERSION="${1:-0.1.3}"
ARCH="$(uname -m)"
if [[ "$ARCH" != "arm64" ]]; then
  print -u2 "This packaging script currently requires Apple Silicon (arm64); found $ARCH"
  exit 1
fi

NODE_SOURCE="$HOME/.hermes/node/bin/node"
if [[ ! -x "$NODE_SOURCE" ]]; then
  print -u2 "Bundled Node runtime not found at $NODE_SOURCE"
  exit 1
fi
if [[ ! -f "$PROJECT/macos/gitBusy.icns" ]]; then
  print -u2 "gitBusy.icns is missing from the macos directory"
  exit 1
fi

OUT="$PROJECT/release"
STAGE="$(mktemp -d /tmp/gitbusy-package.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
rm -rf "$OUT"
mkdir -p "$OUT"

SOURCE_NAME="gitBusy-source-v${VERSION}"
SOURCE_ROOT="$STAGE/$SOURCE_NAME"
mkdir -p "$SOURCE_ROOT"
rsync -a \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'release' \
  --exclude '.gitbusy-runtime' \
  --exclude '.starboard-runtime' \
  "$PROJECT/" "$SOURCE_ROOT/"
ditto -c -k --sequesterRsrc --keepParent "$SOURCE_ROOT" "$OUT/${SOURCE_NAME}.zip"

APP="$STAGE/gitBusy.app"
osacompile -o "$APP" "$PROJECT/macos/gitBusy-bundle.applescript"
cp "$PROJECT/macos/Info.plist" "$APP/Contents/Info.plist"
cp "$PROJECT/macos/gitBusy.icns" "$APP/Contents/Resources/gitBusy.icns"
cp "$PROJECT/scripts/gitbusy-bundle-toggle.zsh" "$APP/Contents/Resources/gitbusy-bundle-toggle.zsh"
chmod +x "$APP/Contents/Resources/gitbusy-bundle-toggle.zsh"
mkdir -p "$APP/Contents/Resources/project"
rsync -a \
  --exclude '.git' \
  --exclude 'node_modules/.cache' \
  --exclude 'dist' \
  --exclude 'release' \
  --exclude '.gitbusy-runtime' \
  --exclude '.starboard-runtime' \
  "$PROJECT/" "$APP/Contents/Resources/project/"
ditto "$PROJECT/node_modules" "$APP/Contents/Resources/project/node_modules"
cp "$NODE_SOURCE" "$APP/Contents/Resources/node"
chmod +x "$APP/Contents/Resources/node"
/usr/bin/codesign --force --deep --sign - "$APP" >/dev/null
/usr/bin/codesign --verify --deep --strict "$APP"

ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/gitBusy-macos-${ARCH}-v${VERSION}.zip"
DMG_ROOT="$STAGE/gitBusy-dmg"
mkdir -p "$DMG_ROOT"
cp -R "$APP" "$DMG_ROOT/gitBusy.app"
cp "$PROJECT/INSTALL.md" "$DMG_ROOT/INSTALL.md"
ln -s /Applications "$DMG_ROOT/Applications"
hdiutil create -volname gitBusy -srcfolder "$DMG_ROOT" -ov -format UDZO "$OUT/gitBusy-macos-${ARCH}-v${VERSION}.dmg" >/dev/null

(cd "$OUT" && shasum -a 256 *.zip *.dmg > SHA256SUMS.txt)
print "Artifacts:"
for artifact in "$OUT"/*.zip "$OUT"/*.dmg "$OUT/SHA256SUMS.txt"; do
  stat -f '%N %z bytes' "$artifact"
done
print "Checks:"
print "architecture=$ARCH"
print "bundle=$APP"
print "codesign=verified"
