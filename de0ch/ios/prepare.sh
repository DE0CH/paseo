#!/usr/bin/env bash
# Generates the iOS project for Deyao's build (APP_VARIANT=de0ch) and installs pods.
# Run from the repo root on macOS after `npm ci`. BUILD_NUMBER sets CFBundleVersion.
set -euo pipefail
cd "$(dirname "$0")/../.."
export APP_VARIANT=de0ch CI=1

npm run build:app-deps
npm run build:terminal-webview --workspace=@getpaseo/app

cd packages/app
npx expo prebuild --platform ios --no-install --clean
if [[ -n "${BUILD_NUMBER:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${BUILD_NUMBER}" ios/Paseo/Info.plist
fi
echo "NODE_BINARY=$(command -v node)" > ios/.xcode.env.local
(cd ios && pod install)
