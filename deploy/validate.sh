#!/usr/bin/env bash
# Smoke-check a deployed dictation origin.
set -euo pipefail

BASE=""
INSECURE=0

usage() {
  echo "Usage: $0 --base http://dictation.example.com"
  echo "       $0 --base https://dictation.example.com --insecure"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

[[ -n "${BASE}" ]] || { usage; exit 1; }
BASE="${BASE%/}"

CURL=(curl -fsS -o /dev/null -w "%{http_code}")
if [[ "${INSECURE}" -eq 1 ]]; then
  CURL+=(-k)
fi

code="$("${CURL[@]}" "${BASE}/" || true)"
if [[ "${code}" == "200" ]]; then
  echo "OK ${code} ${BASE}/"
  exit 0
fi
echo "FAIL ${code:-curl-error} ${BASE}/" >&2
exit 1
