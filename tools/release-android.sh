#!/bin/bash
# Build and sign the Android release APK:
#   dist/puzzlepress-<version>.apk  developer-signed: GitHub release, F-Droid
#                                   reproducible verification, sideload
#
# Never run by CI. The keystore lives outside the repo and its password stays
# in the system keyring (secret-tool lookup service puzzlepress-keystore key
# upload); nothing here prints it.
#
# apksigner from build-tools 34.0.0 on purpose: F-Droid's apksigcopier
# verifies and copies signatures produced by that version; newer build-tools
# emit signatures it rejects. v1 stays off: minSdk 24 verifies v2, and a v1
# JAR signature does not survive apksigcopier byte for byte.
set -euo pipefail
cd "$(dirname "$0")/.."

KEYSTORE="${PUZZLEPRESS_KEYSTORE:-$HOME/keys/puzzlepress-upload.jks}"
ALIAS=puzzlepress-upload
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
SIGN_TOOLS_VERSION=34.0.0

[ -f "$KEYSTORE" ] || { echo "keystore not found: $KEYSTORE"; exit 1; }

KSPW=$(secret-tool lookup service puzzlepress-keystore key upload) || {
  echo "no keystore password in the keyring (service puzzlepress-keystore key upload)"; exit 1;
}
export KSPW

APKSIGNER="$SDK/build-tools/$SIGN_TOOLS_VERSION/apksigner"
if [ ! -x "$APKSIGNER" ]; then
  echo "== installing build-tools $SIGN_TOOLS_VERSION (apksigner pinned for F-Droid) =="
  (yes || true) | "$SDK/cmdline-tools/latest/bin/sdkmanager" "build-tools;$SIGN_TOOLS_VERSION" >/dev/null
  [ -x "$APKSIGNER" ] || { echo "build-tools $SIGN_TOOLS_VERSION did not install"; exit 1; }
fi

echo "== build =="
( cd android && ANDROID_HOME="$SDK" ./gradlew --no-daemon clean assembleRelease )

VERSION=$(grep -oE 'versionName = "[^"]+"' android/app/build.gradle.kts | cut -d'"' -f2)
mkdir -p dist
APK_IN=android/app/build/outputs/apk/release/app-release-unsigned.apk
APK_OUT="dist/puzzlepress-$VERSION.apk"

echo "== sign apk (schemes v2+v3) =="
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" --ks-pass env:KSPW \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true \
  --out "$APK_OUT" "$APK_IN"
"$APKSIGNER" verify --print-certs "$APK_OUT" | head -4

unset KSPW

# Stable-name copy so a landing page or Obtainium can point at
# releases/latest/download/puzzlepress.apk across versions.
cp "$APK_OUT" dist/puzzlepress.apk

echo "== artifacts =="
sha256sum "$APK_OUT" dist/puzzlepress.apk
