#!/usr/bin/env bash
# Run a live gate against dev and prove it saw exactly one build.
#
# dev is a shared deploy target: Cursor writes both repos and CI deploys main
# on every merge. On 2026-07-26 a 90-scenario gate started at 19:50, main was
# merged at 20:03, CI redeployed at 20:04, and the run finished at 20:21 — so
# 30 scenarios measured one build and 60 measured another. The totals looked
# clean and meant nothing. A number that silently spans two builds is worse
# than no number, because it reads as evidence.
#
#   ./scripts/pinned-run.sh <command...>
#
# Records the deployed version before and after. If they differ the run is
# VOID and the exit code is 86 — rerun it, do not report it.

set -uo pipefail

version_id() {
  npx wrangler deployments list --env dev 2>/dev/null \
    | grep -o 'Version(s):[[:space:]]*([0-9]*%)[[:space:]]*[0-9a-f-]*' \
    | tail -1 | awk '{print $NF}'
}

before="$(version_id)"
if [ -z "$before" ]; then
  echo "pinned-run: could not read the deployed version — refusing to run blind." >&2
  exit 87
fi
echo "pinned-run: dev is on $before"
echo "pinned-run: \$ $*"
echo

"$@"
rc=$?

after="$(version_id)"
echo
if [ "$before" != "$after" ]; then
  echo "pinned-run: VOID — dev changed under the run." >&2
  echo "pinned-run:   started on $before" >&2
  echo "pinned-run:   ended on   $after" >&2
  echo "pinned-run: rerun it; do not report these results." >&2
  exit 86
fi

echo "pinned-run: OK — one build throughout ($after), command exit $rc"
exit $rc
