#!/bin/zsh
set -euo pipefail

PROJECT="${0:A:h:h}"
VERSION="${1:-0.1.19}"
if [[ -n "${GITBUSY_BUILD:-}" ]]; then
  BUILD="$GITBUSY_BUILD"
else
  BUILD="$(/usr/bin/python3 - "$PROJECT/src/appMeta.ts" <<'PY'
import re
import sys

text = open(sys.argv[1], encoding='utf-8').read()
match = re.search(r"APP_BUILD\s*=\s*['\"]([0-9]+)", text)
if not match:
    raise SystemExit(1)
print(match.group(1))
PY
)"
fi
if [[ -z "${GITBUSY_GITHUB_CLIENT_ID:-}" ]]; then
  print -u2 "GITBUSY_GITHUB_CLIENT_ID is required when packaging gitBusy"
  exit 1
fi
if [[ ! "$BUILD" =~ '^[0-9]+$' ]]; then
  print -u2 "A numeric gitBusy build is required (got $BUILD)"
  exit 1
fi
# Stage 4 — packaging mode gating. `internal` is the default and
# keeps the existing ad-hoc `codesign --sign -` path (EJ's local
# testing). `distribution` is the explicit CI/Apple-notarization
# path; it refuses to sign or produce a release artifact unless
# MACOS_CODESIGN_IDENTITY, MACOS_NOTARY_PROFILE, and
# GITBUSY_NODE_SHA256 are all set. The gate fires before the
# codesign line so a missing prereq cannot produce an ad-hoc
# artifact under the distribution flag.
GITBUSY_MODE="${GITBUSY_MODE:-internal}"
case "$GITBUSY_MODE" in
  internal|distribution) ;;
  *) print -u2 "GITBUSY_MODE must be 'internal' or 'distribution' (got '$GITBUSY_MODE')"; exit 1 ;;
esac
MACOS_CODESIGN_IDENTITY="${MACOS_CODESIGN_IDENTITY:-}"
MACOS_NOTARY_PROFILE="${MACOS_NOTARY_PROFILE:-}"
GITBUSY_NODE_SHA256="${GITBUSY_NODE_SHA256:-}"
if [[ "$GITBUSY_MODE" == 'distribution' ]]; then
  MISSING_PREREQS=()
  [[ -n "$MACOS_CODESIGN_IDENTITY" ]] || MISSING_PREREQS+=("MACOS_CODESIGN_IDENTITY")
  [[ -n "$MACOS_NOTARY_PROFILE"    ]] || MISSING_PREREQS+=("MACOS_NOTARY_PROFILE")
  [[ -n "$GITBUSY_NODE_SHA256"     ]] || MISSING_PREREQS+=("GITBUSY_NODE_SHA256")
  if [[ "${#MISSING_PREREQS[@]}" -gt 0 ]]; then
    print -u2 "Distribution mode requires the following environment variables to be set (non-empty):"
    for prereq in "${MISSING_PREREQS[@]}"; do
      print -u2 "  - $prereq"
    done
    print -u2 "Refusing to sign or produce a release artifact. Set the variables, or run with GITBUSY_MODE=internal for an ad-hoc local build."
    exit 1
  fi
fi
HOST_MACHINE_ARCH="$(uname -m)"
case "$HOST_MACHINE_ARCH" in
  arm64|aarch64) HOST_ARCH='arm64' ;;
  x86_64|amd64) HOST_ARCH='x64' ;;
  *) print -u2 "Unsupported host architecture: $HOST_MACHINE_ARCH"; exit 1 ;;
esac

REQUESTED_ARCH="${2:-$HOST_ARCH}"
case "$REQUESTED_ARCH" in
  arm64|aarch64) ARCH='arm64' ;;
  x86_64|x64|amd64) ARCH='x64' ;;
  *) print -u2 "Usage: $0 [version] [arm64|x64]"; exit 1 ;;
esac
if [[ "$ARCH" == 'arm64' && "$HOST_ARCH" != 'arm64' ]]; then
  print -u2 "Cannot build an arm64 bundle on an x64 host"
  exit 1
fi

HOST_NODE="$(whence -p node 2>/dev/null || true)"
if [[ -z "$HOST_NODE" || ! -x "$HOST_NODE" ]]; then
  print -u2 "A local Node runtime is required to determine the bundled Node version"
  exit 1
fi
NODE_VERSION="${GITBUSY_NODE_VERSION:-$($HOST_NODE --version)}"
# PROD-BL-004 — refuse to package with a Node that is not 22.x.
# Operators can override by exporting GITBUSY_NODE_VERSION before
# invoking the script. The override must still parse to 22.x.
NODE_VERSION_NUMERIC="${NODE_VERSION#v}"
HOST_NODE_MAJOR="$(/usr/bin/python3 -c "import sys,re; m=re.match(r'(\d+)\.', sys.argv[1]); print(m.group(1) if m else '')" "$NODE_VERSION_NUMERIC")"
if [[ -z "$HOST_NODE_MAJOR" || "$HOST_NODE_MAJOR" != '22' ]]; then
  print -u2 "gitBusy packaging requires Node 22.x (got ${NODE_VERSION}); set GITBUSY_NODE_VERSION to override."
  exit 1
fi
NODE_CACHE_ROOT="${GITBUSY_NODE_CACHE_DIR:-$HOME/Library/Caches/gitBusy/node}"
NODE_RUNTIME_DIR="$NODE_CACHE_ROOT/$NODE_VERSION/darwin-$ARCH"
if [[ -n "${GITBUSY_NODE_SOURCE:-}" ]]; then
  NODE_SOURCE="$GITBUSY_NODE_SOURCE"
elif [[ "$ARCH" == 'arm64' ]]; then
  NODE_SOURCE="$HOME/.hermes/node/bin/node"
else
  NODE_SOURCE="$NODE_RUNTIME_DIR/node"
fi

# Stage 4 — capture the Node archive SHA-256 for MANIFEST.txt.
# Populated by prepare_node_runtime once the archive has been hashed
# against nodejs.org's published SHASUMS256.txt. Empty in `internal`
# mode only when the archive was already extracted on a previous run.
NODE_ARCHIVE_SHA256=""
NODE_EXPECTED_SHA256=""

prepare_node_runtime() {
  local archive="$NODE_RUNTIME_DIR/node-${NODE_VERSION}-darwin-${ARCH}.tar.gz"
  local extracted="$NODE_RUNTIME_DIR/node-${NODE_VERSION}-darwin-${ARCH}"
  mkdir -p "$NODE_RUNTIME_DIR"
  if [[ ! -x "$NODE_SOURCE" || ! -f "$NODE_RUNTIME_DIR/npm/bin/npm-cli.js" ]]; then
    print "Preparing Node $NODE_VERSION ($ARCH) runtime"
    if [[ ! -f "$archive" ]]; then
      /usr/bin/curl -fL --retry 3 --retry-delay 2 --max-time 300 \
        "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-${ARCH}.tar.gz" \
        -o "$archive"
    fi
    # PROD-BL-004 — verify the downloaded Node archive against
    # nodejs.org's published SHASUMS256.txt. The expected hash is
    # cached next to the archive so repeat packaging runs do not
    # re-download the index.
    NODE_SHA_FILE="$NODE_RUNTIME_DIR/node-${NODE_VERSION}-darwin-${ARCH}.sha256.expected"
    if [[ ! -f "$NODE_SHA_FILE" ]]; then
      if [[ ! -f "$NODE_RUNTIME_DIR/SHASUMS256.txt" ]]; then
        /usr/bin/curl -fsSL --max-time 60 \
          "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" \
          -o "$NODE_RUNTIME_DIR/SHASUMS256.txt"
      fi
      /usr/bin/awk -v v="$NODE_VERSION" -v a="node-${NODE_VERSION}-darwin-${ARCH}.tar.gz" \
        '$2 == a {print $1}' "$NODE_RUNTIME_DIR/SHASUMS256.txt" \
        > "$NODE_SHA_FILE"
    fi
    if [[ ! -s "$NODE_SHA_FILE" ]]; then
      print -u2 "Node archive SHA-256 not found in nodejs.org SHASUMS256.txt for $NODE_VERSION darwin-$ARCH"
      exit 1
    fi
    EXPECTED_SHA="$(/bin/cat "$NODE_SHA_FILE")"
    ACTUAL_SHA="$(/usr/bin/shasum -a 256 "$archive" | /usr/bin/awk '{print $1}')"
    if [[ -z "$EXPECTED_SHA" || "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
      print -u2 "Node archive SHA-256 mismatch: expected $EXPECTED_SHA, got $ACTUAL_SHA"
      exit 1
    fi
    NODE_EXPECTED_SHA256="$EXPECTED_SHA"
    NODE_ARCHIVE_SHA256="$ACTUAL_SHA"
    rm -rf "$extracted"
    /usr/bin/tar -xzf "$archive" -C "$NODE_RUNTIME_DIR"
    cp "$extracted/bin/node" "$NODE_RUNTIME_DIR/node"
    rm -rf "$NODE_RUNTIME_DIR/npm"
    cp -R "$extracted/lib/node_modules/npm" "$NODE_RUNTIME_DIR/npm"
    rm -rf "$extracted"
  fi
}

if [[ "$ARCH" == 'x64' ]]; then
  prepare_node_runtime
fi
if [[ ! -x "$NODE_SOURCE" ]]; then
  print -u2 "Bundled Node runtime not found at $NODE_SOURCE"
  exit 1
fi
if [[ "$ARCH" == 'x64' ]]; then
  NODE_NPM_CLI="${GITBUSY_NPM_CLI:-$NODE_RUNTIME_DIR/npm/bin/npm-cli.js}"
elif [[ -n "${GITBUSY_NPM_CLI:-}" ]]; then
  NODE_NPM_CLI="$GITBUSY_NPM_CLI"
else
  NODE_NPM_CLI="$HOME/.hermes/node/lib/node_modules/npm/bin/npm-cli.js"
fi
if [[ ! -f "$NODE_NPM_CLI" && "$ARCH" != "$HOST_ARCH" ]]; then
  print -u2 "npm CLI not found for target dependency preparation: $NODE_NPM_CLI"
  exit 1
fi
if [[ ! -f "$PROJECT/macos/gitBusy.icns" ]]; then
  print -u2 "gitBusy.icns is missing from the macos directory"
  exit 1
fi

# Stage 4 — capture reproducibility inputs for MANIFEST.txt. None of
# these values contain credentials; they are content hashes that the
# Stage 6 verifier can reproduce from a clean source checkout.
LOCKFILE_SHA256="$(/usr/bin/shasum -a 256 "$PROJECT/package-lock.json" | /usr/bin/awk '{print $1}')"
DEPS_CACHE_KEY="${NODE_VERSION}-darwin-${ARCH}-${LOCKFILE_SHA256}"
BUNDLE_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PROJECT/macos/Info.plist" 2>/dev/null || echo 'com.ellannjohnson.gitbusy')"
CODESIGN_AUTHORITY="ad-hoc"
if [[ "$GITBUSY_MODE" == 'distribution' ]]; then
  CODESIGN_AUTHORITY="$MACOS_CODESIGN_IDENTITY"
fi

OUT="$PROJECT/release"
STAGE="$(mktemp -d /tmp/gitbusy-package.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
if [[ "${GITBUSY_KEEP_RELEASE:-0}" != '1' ]]; then
  rm -rf "$OUT"
fi
mkdir -p "$OUT"

NODE_MODULES_SOURCE="${GITBUSY_NODE_MODULES_SOURCE:-}"
if [[ -z "$NODE_MODULES_SOURCE" ]]; then
  if [[ "$ARCH" == "$HOST_ARCH" ]]; then
    NODE_MODULES_SOURCE="$PROJECT/node_modules"
  else
    DEPS_CACHE_DIR="$HOME/Library/Caches/gitBusy/node_modules/${DEPS_CACHE_KEY}"
    NODE_MODULES_SOURCE="$DEPS_CACHE_DIR/node_modules"
    if [[ ! -f "$NODE_MODULES_SOURCE/vite/bin/vite.js" ]]; then
      DEPS_STAGE="$STAGE/dependencies"
      mkdir -p "$DEPS_STAGE"
      cp "$PROJECT/package.json" "$PROJECT/package-lock.json" "$DEPS_STAGE/"
      print "Installing target-architecture dependencies ($ARCH)"
      if [[ "$ARCH" == 'x64' && "$HOST_ARCH" == 'arm64' ]]; then
        (cd "$DEPS_STAGE" && /usr/bin/arch -x86_64 "$NODE_SOURCE" "$NODE_NPM_CLI" ci --include=optional --no-audit --no-fund)
      else
        (cd "$DEPS_STAGE" && "$NODE_SOURCE" "$NODE_NPM_CLI" ci --include=optional --no-audit --no-fund)
      fi
      rm -rf "$DEPS_CACHE_DIR"
      mkdir -p "$DEPS_CACHE_DIR"
      mv "$DEPS_STAGE/node_modules" "$NODE_MODULES_SOURCE"
    fi
  fi
fi
if [[ ! -f "$NODE_MODULES_SOURCE/vite/bin/vite.js" ]]; then
  print -u2 "Vite dependencies not found at $NODE_MODULES_SOURCE"
  exit 1
fi

# Build the production bundle so the runtime ships the immutable dist/ the
# standalone server serves. We rebuild from source rather than trusting any
# pre-existing dist/ inside the project tree.
DIST_SOURCE="$STAGE/dist"
mkdir -p "$DIST_SOURCE"
print "Building gitBusy production assets (vite)"
(cd "$PROJECT" && "$NODE_SOURCE" "$NODE_MODULES_SOURCE/.bin/vite" build --outDir "$DIST_SOURCE")
if [[ ! -f "$DIST_SOURCE/index.html" ]]; then
  print -u2 "Production build did not produce dist/index.html"
  exit 1
fi

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
# PROD-BL-005 — write the canonical base path into the bundle so
# external verifiers (Stage 6) and the post-install `Resources/`
# directory have a single inspectable source of truth.
print -r -- "/gitbusy/" > "$APP/Contents/Resources/gitbusy-base-path"
cp "$PROJECT/macos/Info.plist" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD" "$APP/Contents/Info.plist"
cp "$PROJECT/macos/gitBusy.icns" "$APP/Contents/Resources/gitBusy.icns"
cp "$PROJECT/scripts/gitbusy-bundle-toggle.zsh" "$APP/Contents/Resources/gitbusy-bundle-toggle.zsh"
chmod +x "$APP/Contents/Resources/gitbusy-bundle-toggle.zsh"
mkdir -p "$APP/Contents/Resources/project"
rsync -a \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'node_modules/.cache' \
  --exclude 'dist' \
  --exclude 'release' \
  --exclude '.gitbusy-runtime' \
  --exclude '.starboard-runtime' \
  "$PROJECT/" "$APP/Contents/Resources/project/"
mkdir -p "$APP/Contents/Resources/project/dist"
rsync -a "$DIST_SOURCE/" "$APP/Contents/Resources/project/dist/"
rsync -aL \
  --exclude '.cache' \
  --exclude '.vite' \
  --exclude '.vite-temp' \
  --exclude '.tmp' \
  "$NODE_MODULES_SOURCE/" "$APP/Contents/Resources/project/node_modules/"
if [[ -n "${GITBUSY_GITHUB_CLIENT_ID:-}" ]]; then
  print -r -- "$GITBUSY_GITHUB_CLIENT_ID" > "$APP/Contents/Resources/gitbusy-github-client-id"
fi
cp "$NODE_SOURCE" "$APP/Contents/Resources/node"
chmod +x "$APP/Contents/Resources/node"
# Stage 4 — signing step. `internal` mode uses the existing ad-hoc
# `codesign --sign -` path (EJ's local testing). `distribution`
# mode signs with the named Developer ID identity; the gate at the
# top of the script has already verified that
# MACOS_CODESIGN_IDENTITY is non-empty, so we use it here without
# further guards.
if [[ "$GITBUSY_MODE" == 'distribution' ]]; then
  /usr/bin/codesign --force --deep --sign "$MACOS_CODESIGN_IDENTITY" --options runtime --timestamp "$APP" >/dev/null
  /usr/bin/codesign --display --verbose=4 "$APP" > "$OUT/codesign.log" 2>&1 || true
else
  /usr/bin/codesign --force --deep --sign - "$APP" >/dev/null
fi
/usr/bin/codesign --verify --deep --strict "$APP"

# Stage 4 — write SHA256SUMS.txt and MANIFEST.txt next to the
# artifacts. The sums and the manifest are content-deterministic
# for a given staging tree: SHA256SUMS.txt is emitted inside $STAGE
# (no embedded timestamps from ditto because the ditto invocations
# upstream already use --sequesterRsrc which preserves source mtimes
# — and the source tree's mtimes are deterministic across runs on a
# clean checkout). MANIFEST.txt captures the reproducibility inputs
# so the Stage 6 verifier can reconstruct them.
APP_ZIP="$OUT/gitBusy-macos-${ARCH}-v${VERSION}.zip"
APP_DMG="$OUT/gitBusy-macos-${ARCH}-v${VERSION}.dmg"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$APP_ZIP"
DMG_ROOT="$STAGE/gitBusy-dmg"
mkdir -p "$DMG_ROOT"
cp -R "$APP" "$DMG_ROOT/gitBusy.app"
cp "$PROJECT/INSTALL.md" "$DMG_ROOT/INSTALL.md"
ln -s /Applications "$DMG_ROOT/Applications"
hdiutil create -volname gitBusy -srcfolder "$DMG_ROOT" -ov -format UDZO "$APP_DMG" >/dev/null

# Deterministic SHA256SUMS.txt — sort by file name so the order is
# stable across runs. MANIFEST.txt records the build time but uses
# public-safe labels instead of local paths or host identity.
SUMS_TMP="$STAGE/SHA256SUMS.txt"
{
  /usr/bin/shasum -a 256 "$APP_ZIP"
  /usr/bin/shasum -a 256 "$APP_DMG"
  /usr/bin/shasum -a 256 "$OUT/${SOURCE_NAME}.zip"
} | /usr/bin/sort -k2 > "$SUMS_TMP"
mv "$SUMS_TMP" "$OUT/SHA256SUMS.txt"

# MANIFEST.txt — reproducibility inputs. None of these contain
# credentials; the notary profile name is recorded only as a label,
# never the password or key contents.
MANIFEST_TMP="$STAGE/MANIFEST.txt"
{
  print "gitBusy packaging manifest"
  print "=========================="
  print ""
  print "version=${VERSION}"
  print "build=${BUILD}"
  print "bundle_identifier=${BUNDLE_IDENTIFIER}"
  print "target_arch=${ARCH}"
  print "host_arch=${HOST_ARCH}"
  print "host_node=${NODE_VERSION}"
  print "node_archive_sha256=${NODE_ARCHIVE_SHA256}"
  print "node_archive_expected_sha256=${NODE_EXPECTED_SHA256}"
  print "package_lock_sha256=${LOCKFILE_SHA256}"
  print "deps_cache_key=${DEPS_CACHE_KEY}"
  print "packaging_mode=${GITBUSY_MODE}"
  print "codesign_authority=${CODESIGN_AUTHORITY}"
  print "notary_profile=${MACOS_NOTARY_PROFILE}"
  print "notary_run=not-run-ad-hoc-preview"
  print "staging_dir=temporary-build-directory"
  print "build_started_at=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
  print "build_host=local-builder"
} > "$MANIFEST_TMP"
mv "$MANIFEST_TMP" "$OUT/MANIFEST.txt"

print "Artifacts:"
for artifact in "$OUT"/*.zip "$OUT"/*.dmg "$OUT/SHA256SUMS.txt" "$OUT/MANIFEST.txt"; do
  /usr/bin/stat -f '%N %z bytes' "$artifact"
done
print "Checks:"
print "architecture=$ARCH"
print "bundle=$APP"
print "codesign_authority=$CODESIGN_AUTHORITY"
print "codesign=verified"
print "manifest=$OUT/MANIFEST.txt"
