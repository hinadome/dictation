#!/usr/bin/env bash
# Smoke-check a deployed dictation origin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/container/docker-compose.yml"

BASE=""
INSECURE=0
CHECK_NONROOT=0

usage() {
  echo "Usage: $0 --base http://dictation.example.com"
  echo "       $0 --base https://dictation.example.com --insecure"
  echo "       $0 --check-nonroot            # assert containers run as non-root (UID != 0)"
  echo "       $0 --base http://127.0.0.1 --check-nonroot"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    --check-nonroot) CHECK_NONROOT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

# --- Optional: assert the container services run as a non-root user ----------
# Verifies the hardening in docker-compose.yml / Dockerfile (nginx-unprivileged,
# UID 101). Opt-in because it requires Docker; the HTTP smoke test does not.
check_nonroot() {
  command -v docker >/dev/null 2>&1 || { echo "FAIL docker not found (--check-nonroot)" >&2; return 1; }
  docker compose version >/dev/null 2>&1 || { echo "FAIL 'docker compose' not available" >&2; return 1; }
  [[ -f "${COMPOSE_FILE}" ]] || { echo "FAIL compose file missing: ${COMPOSE_FILE}" >&2; return 1; }

  local compose=(docker compose -f "${COMPOSE_FILE}")
  local rc=0 svc uid

  for svc in app gateway; do
    # `id -u` inside the running service container; must be present and non-zero.
    if ! uid="$("${compose[@]}" exec -T "${svc}" id -u 2>/dev/null | tr -d '[:space:]')"; then
      echo "FAIL ${svc}: not running or 'exec' failed" >&2
      rc=1
      continue
    fi
    if [[ -z "${uid}" ]]; then
      echo "FAIL ${svc}: could not read UID" >&2
      rc=1
    elif [[ "${uid}" == "0" ]]; then
      echo "FAIL ${svc}: running as root (UID 0)" >&2
      rc=1
    else
      echo "OK   ${svc}: non-root (UID ${uid})"
    fi
  done

  return "${rc}"
}

if [[ "${CHECK_NONROOT}" -eq 1 ]]; then
  check_nonroot || exit 1
  # If no --base given, the non-root check is the whole job.
  [[ -n "${BASE}" ]] || exit 0
fi

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
