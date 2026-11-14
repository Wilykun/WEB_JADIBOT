#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${1:-"${PROJECT_ROOT}/../ReadSW-Console-deployed.zip"}"

mkdir -p "$(dirname "$OUTPUT_PATH")"
rm -f "$OUTPUT_PATH"

cd "$PROJECT_ROOT"
zip -qr "$OUTPUT_PATH" . \
  -x 'node_modules/*' \
     'node_modules/**' \
     "$(basename "$OUTPUT_PATH")"

printf 'ZIP dibuat: %s\n' "$OUTPUT_PATH"
printf 'node_modules: dikecualikan\n'
printf 'Data penting: config.json, runtime-data/, DATA_AKUN/ ikut jika tersedia\n'
