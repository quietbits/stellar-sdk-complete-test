#!/usr/bin/env bash
# Package-manager axis: install @stellar/stellar-sdk under each manager's
# dependency layout and run the smoke test through that layout. Validates
# install/resolution, which is orthogonal to the runtime axis (tests/).
#
# Each sandbox runs under Node — the canonical consumer. Yarn Berry runs the
# test via `yarn node` so resolution goes through its PnP loader.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PM_DIR="$ROOT/package-managers"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

declare -a SUMMARY=()

run_pm() {
  local name="$1" tool="$2" install_cmd="$3" run_cmd="$4"
  echo
  echo "=================== $name ==================="
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP: '$tool' not installed"
    SUMMARY+=("$name: SKIP (no $tool)")
    return
  fi
  if (cd "$PM_DIR/$name" && eval "$install_cmd" && eval "$run_cmd"); then
    SUMMARY+=("$name: PASS")
  else
    SUMMARY+=("$name: FAIL")
  fi
}

run_pm "npm" npm \
  "npm install --no-audit --no-fund --silent" \
  "node --test smoke.test.mjs"

run_pm "pnpm" pnpm \
  "pnpm install --silent" \
  "node --test smoke.test.mjs"

run_pm "yarn-classic" yarn \
  "yarn install --silent" \
  "node --test smoke.test.mjs"

run_pm "yarn-berry" corepack \
  "touch yarn.lock && corepack yarn install" \
  "corepack yarn node --test smoke.test.mjs"

echo
echo "=================== SUMMARY ==================="
rc=0
for line in "${SUMMARY[@]}"; do
  echo "  $line"
  [[ "$line" == *": FAIL" ]] && rc=1
done
exit "$rc"
