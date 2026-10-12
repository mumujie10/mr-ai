#!/usr/bin/env bash
# Notarize a built DMG and staple it, tolerating transient App Store Connect
# status-poll failures.
#
# Why this exists instead of `notarytool submit --wait`: a single timed-out
# poll (NSURLErrorDomain -1001 on a 60s request) makes --wait fail the whole
# submission — observed as the x86_64 job erroring while the same DMG shape
# was Accepted on arm64 minutes earlier. Submit once, then poll `notarytool
# info` ourselves so one dropped request costs a retry, not a release.
#
# Usage: scripts/notarize-dmg.sh <path-to-dmg> <keychain-profile>
set -euo pipefail

DMG="${1:?usage: notarize-dmg.sh <dmg> <keychain-profile>}"
PROFILE="${2:?usage: notarize-dmg.sh <dmg> <keychain-profile>}"
[ -f "$DMG" ] || { echo "error: no such dmg: $DMG" >&2; exit 1; }

POLL_MAX="${POLL_MAX:-60}"
POLL_INTERVAL="${POLL_INTERVAL:-20}"

submission=$(xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE")
printf '%s\n' "$submission"
id=$(printf '%s\n' "$submission" \
  | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
  | head -n 1 || true)
if [ -z "$id" ]; then
  echo "error: no submission id in notarytool output" >&2
  exit 1
fi

accepted=0
for attempt in $(seq 1 "$POLL_MAX"); do
  # `info` can exit non-zero while still printing the status, so read the
  # status from the output either way: only a poll with no status at all
  # counts as lost.
  if info=$(xcrun notarytool info "$id" --keychain-profile "$PROFILE" --output-format json 2>&1); then
    poll_ok=1
  else
    poll_ok=0
  fi
  status=$(printf '%s' "$info" \
    | grep -oE '"status"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | head -n 1 \
    | sed -E 's/.*"([^"]+)"$/\1/' || true)
  if [ "$poll_ok" != 1 ] && [ -z "$status" ]; then
    echo "warning: notary status poll $attempt failed: $(printf '%s' "$info" | tail -n 1)" >&2
  fi
  case "$status" in
    Accepted)
      echo "notary accepted submission $id"
      accepted=1
      break
      ;;
    Invalid)
      echo "error: notary rejected $DMG" >&2
      xcrun notarytool log "$id" --keychain-profile "$PROFILE" || true
      exit 1
      ;;
    *)
      echo "notary status: ${status:-unavailable} (poll $attempt/$POLL_MAX)"
      ;;
  esac
  sleep "$POLL_INTERVAL"
done

if [ "$accepted" != 1 ]; then
  echo "error: notary did not accept the submission within $((POLL_MAX * POLL_INTERVAL))s" >&2
  exit 1
fi

xcrun stapler staple "$DMG"
