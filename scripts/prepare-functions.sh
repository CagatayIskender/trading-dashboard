#!/usr/bin/env bash
# Copies the shared engine into each Edge Function folder before deploying.
set -euo pipefail
cd "$(dirname "$0")/.."
for fn in engine-tick panel-api; do
  rm -rf "supabase/functions/$fn/engine"
  cp -r engine "supabase/functions/$fn/engine"
done
