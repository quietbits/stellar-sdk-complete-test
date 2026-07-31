#!/usr/bin/env bash
# Runtime axis: run the same suite under Node, Deno and Bun, and report all
# three regardless of whether an earlier one failed.
#
# The point of this axis is the *comparison* between runtimes: a failure only
# on Bun means something different from the same failure everywhere. Chaining
# the three with `&&` defeats that — the first non-zero exit stops the run, and
# with the surface locks deliberately red until v17 (ISSUES.md issue 4), Node
# always exits non-zero, so Deno and Bun would never run at all.
#
# Mirrors scripts/test-pms.sh: every runtime runs, results are summarised, and
# the exit code is non-zero if any of them failed.
#
# STELLAR_LIVE is inherited, so `STELLAR_LIVE=0 npm run test:all` skips the
# live testnet tests in all three, exactly as it does for the individual scripts.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

declare -a SUMMARY=()

run_runtime() {
  local name="$1" tool="$2" cmd="$3"
  echo
  echo "=================== $name ==================="
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP: '$tool' not installed"
    SUMMARY+=("$name: SKIP (no $tool)")
    return
  fi
  if eval "$cmd"; then
    SUMMARY+=("$name: PASS")
  else
    SUMMARY+=("$name: FAIL")
  fi
}

run_runtime "node" node "npm run --silent test:node"
run_runtime "deno" deno "npm run --silent test:deno"
run_runtime "bun"  bun  "npm run --silent test:bun"

echo
echo "=================== SUMMARY ==================="
rc=0
for line in "${SUMMARY[@]}"; do
  echo "  $line"
  [[ "$line" == *": FAIL" ]] && rc=1
done
exit "$rc"
