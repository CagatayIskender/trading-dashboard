#!/usr/bin/env bash
# Copies the shared engine into the Edge Function folder before `supabase functions deploy`.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf supabase/functions/engine-tick/engine
cp -r engine supabase/functions/engine-tick/engine
