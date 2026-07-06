#!/usr/bin/env bash
# Visit-route UAT regression — run after any ConverseSpine visit / origin change.
set -euo pipefail
cd "$(dirname "$0")/.."
npm test -- --run \
  tests/visit-route.test.ts \
  tests/visit-origin.test.ts \
  tests/visit-slot-relative.test.ts \
  tests/map-visit-itinerary.test.ts \
  tests/map-visit-queue.test.ts \
  tests/rti-visit-gate.test.ts
