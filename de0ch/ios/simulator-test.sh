#!/usr/bin/env bash
# Simulator test for Deyao's build: launch the app with a Jarvis token (launch arguments, never
# saved by the app), open Settings → Jarvis, and check with Maestro that it is paired and — when
# Jarvis has a started OpenCode session — that the session is imported, named, and goes Online.
# Usage: simulator-test.sh <path to Paseo.app>   env: JARVIS_E2E_CLIENT_ID / _SECRET, JARVIS_URL
set -euo pipefail
APP="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${GITHUB_WORKSPACE:-$PWD}/de0ch-test-output"
JARVIS_URL="${JARVIS_URL:-https://jarvis.deyaochen.com}"
mkdir -p "$OUT"
: "${JARVIS_E2E_CLIENT_ID:?missing}" "${JARVIS_E2E_CLIENT_SECRET:?missing}"

if ! command -v maestro >/dev/null; then
  curl -fsSL "https://get.maestro.mobile.dev" | bash
  export PATH="$HOME/.maestro/bin:$PATH"
fi

# Newest iOS runtime, an iPhone 17 (or any iPhone) on it.
RUNTIME=$(xcrun simctl list runtimes -j | python3 -c '
import json,sys
rs=[r for r in json.load(sys.stdin)["runtimes"] if r["isAvailable"] and r["platform"]=="iOS"]
print(sorted(rs,key=lambda r:[int(x) for x in r["version"].split(".")])[-1]["identifier"])')
DEVICE_TYPE=$(xcrun simctl list devicetypes -j | python3 -c '
import json,sys
ts=[t["identifier"] for t in json.load(sys.stdin)["devicetypes"] if "iPhone" in t["name"]]
pick=[t for t in ts if t.endswith("iPhone-17")] or ts
print(pick[-1])')
UDID=$(xcrun simctl create "de0ch-e2e" "$DEVICE_TYPE" "$RUNTIME")
echo "simulator $UDID ($DEVICE_TYPE, $RUNTIME)"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"

# The session to look for: the first started OpenCode session whose daemon answers.
REMOTES=$(curl -fsS -H "CF-Access-Client-Id: $JARVIS_E2E_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $JARVIS_E2E_CLIENT_SECRET" "$JARVIS_URL/api/remotes?harness=opencode")
read -r SESSION_ID SESSION_TITLE < <(printf '%s' "$REMOTES" | python3 -c '
import json,re,sys
for s in json.load(sys.stdin).get("sessions",[]):
    if s.get("state")=="started" and s.get("pairUrl"):
        title=(s.get("title") or "").strip() or s["id"]
        print(s["id"], re.escape(title)); break')  || true
echo "sessions listed: $(printf '%s' "$REMOTES" | python3 -c 'import json,sys; print([(s["id"],s["state"]) for s in json.load(sys.stdin)["sessions"]])')"

xcrun simctl launch "$UDID" dev.de0ch.paseo \
  -jarvisE2EClientId "$JARVIS_E2E_CLIENT_ID" -jarvisE2EClientSecret "$JARVIS_E2E_CLIENT_SECRET"
sleep 8
xcrun simctl openurl "$UDID" "paseo://settings/jarvis"

status=0
maestro --device "$UDID" test --test-output-dir "$OUT/paired" "$HERE/maestro/jarvis-paired.yaml" || status=$?
if [[ $status -eq 0 && -n "${SESSION_ID:-}" ]]; then
  echo "checking session $SESSION_ID"
  maestro --device "$UDID" test --test-output-dir "$OUT/session" \
    -e SESSION_ID="$SESSION_ID" -e SESSION_TITLE="$SESSION_TITLE" \
    "$HERE/maestro/jarvis-session.yaml" || status=$?
elif [[ $status -eq 0 ]]; then
  echo "No started OpenCode session in Jarvis: checked pairing only."
fi
xcrun simctl io "$UDID" screenshot "$OUT/final.png" || true
xcrun simctl shutdown "$UDID" || true
xcrun simctl delete "$UDID" || true
exit $status
