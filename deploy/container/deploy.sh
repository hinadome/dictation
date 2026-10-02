#!/usr/bin/env bash
# Container deploy for dictation — Compose app + nginx FrontendGateway.
# Does NOT edit the host /etc/nginx configuration.
set -euo pipefail

APP_NAME="dictation"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${SCRIPT_DIR}/certs"
TLS_SOURCE_FILE="${CERT_DIR}/.tls-source"
COMPOSE=(docker compose -f "${SCRIPT_DIR}/docker-compose.yml")
GATEWAY_ACTIVE="${SCRIPT_DIR}/nginx/gateway.active.conf"

DOMAIN=""
EMAIL=""
MODE=""
FORCE_SELF_SIGNED=0
FORCE_CERTBOT=0
NO_BUILD=0

usage() {
  cat <<EOF
Usage: $0 --domain <host> (--no-tls | --self-signed | --certbot --email <addr>) [options]

Required (pick one TLS mode):
  --no-tls                 HTTP-only verify mode (no certificates)
  --self-signed            HTTPS with openssl PEMs in deploy/container/certs/
  --certbot                HTTPS with Let's Encrypt (webroot via gateway)

Options:
  --domain <host>          Public hostname
  --email <addr>           Let's Encrypt email (with --certbot)
  --force-self-signed      Replace certs with new self-signed
  --force-certbot          Force re-issue Let's Encrypt
  --no-build               Re-run compose without rebuilding images
  --skip-certbot           Alias for --self-signed
  -h, --help               Show help

Examples:
  $0 --domain dictation.example.com --no-tls
  $0 --domain dictation.example.com --self-signed
  $0 --domain dictation.example.com --certbot --email you@example.com
EOF
}

log() { printf '[%s-container] %s\n' "${APP_NAME}" "$*"; }
die() { printf '[%s-container] ERROR: %s\n' "${APP_NAME}" "$*" >&2; exit 1; }

write_tls_source() { mkdir -p "${CERT_DIR}"; echo "$1" > "${TLS_SOURCE_FILE}"; }
current_tls_source() { [[ -f "${TLS_SOURCE_FILE}" ]] && cat "${TLS_SOURCE_FILE}" || echo ""; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain) DOMAIN="${2:-}"; shift 2 ;;
      --email) EMAIL="${2:-}"; shift 2 ;;
      --no-tls) MODE="no-tls"; shift ;;
      --self-signed|--skip-certbot) MODE="self-signed"; shift ;;
      --force-self-signed) MODE="self-signed"; FORCE_SELF_SIGNED=1; shift ;;
      --certbot) MODE="certbot"; shift ;;
      --force-certbot) MODE="certbot"; FORCE_CERTBOT=1; shift ;;
      --no-build) NO_BUILD=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown argument: $1" ;;
    esac
  done
  [[ -n "${DOMAIN}" ]] || die "--domain is required"
  [[ -n "${MODE}" ]] || die "Choose --no-tls, --self-signed, or --certbot"
  if [[ "${MODE}" == "certbot" && -z "${EMAIL}" ]]; then
    die "--certbot requires --email"
  fi
  command -v docker >/dev/null 2>&1 || die "docker not found"
  docker compose version >/dev/null 2>&1 || die "docker compose not found"
}

ensure_env_file() {
  # Compose requires the file to exist when listed under env_file.
  if [[ ! -f "${SCRIPT_DIR}/.env.production" ]]; then
    cp "${SCRIPT_DIR}/env.production.example" "${SCRIPT_DIR}/.env.production"
    log "Created ${SCRIPT_DIR}/.env.production from example"
  fi
}

render_gateway() {
  mkdir -p "${SCRIPT_DIR}/nginx" "${CERT_DIR}"
  if [[ "${MODE}" == "no-tls" ]]; then
    sed -e "s|__DOMAIN__|${DOMAIN}|g" \
      "${SCRIPT_DIR}/nginx/gateway-http.conf.template" > "${GATEWAY_ACTIVE}"
  else
    sed -e "s|__DOMAIN__|${DOMAIN}|g" \
      "${SCRIPT_DIR}/nginx/gateway-tls.conf.template" > "${GATEWAY_ACTIVE}"
  fi
}

make_self_signed_pem() {
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "${CERT_DIR}/privkey.pem" -out "${CERT_DIR}/fullchain.pem" \
    -subj "/CN=${DOMAIN}" 2>/dev/null \
  || openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "${CERT_DIR}/privkey.pem" -out "${CERT_DIR}/fullchain.pem" \
    -subj "/CN=${DOMAIN}"
}

ensure_self_signed() {
  mkdir -p "${CERT_DIR}"
  local cur
  cur="$(current_tls_source)"
  if [[ "${FORCE_SELF_SIGNED}" -ne 1 && "${cur}" == "self-signed" \
        && -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
    log "Reusing existing self-signed certs in ${CERT_DIR}"
    return 0
  fi
  rm -f "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/privkey.pem"
  make_self_signed_pem
  # Readable by the non-root gateway user (UID 101) via the read-only mount.
  chmod 644 "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/privkey.pem" 2>/dev/null || true
  write_tls_source self-signed
  log "Wrote self-signed PEMs to ${CERT_DIR}"
}

ensure_placeholder_certs() {
  mkdir -p "${CERT_DIR}"
  if [[ ! -f "${CERT_DIR}/fullchain.pem" || ! -f "${CERT_DIR}/privkey.pem" ]]; then
    log "Creating temporary self-signed PEMs so the TLS mount is valid…"
    FORCE_SELF_SIGNED=1
    ensure_self_signed
  fi
}

compose_up() {
  if [[ "${NO_BUILD}" -eq 1 ]]; then
    "${COMPOSE[@]}" up -d
  else
    "${COMPOSE[@]}" up -d --build
  fi
  log "Compose services are up."
}

ensure_certbot() {
  mkdir -p "${CERT_DIR}"
  if [[ "${FORCE_CERTBOT}" -ne 1 && "$(current_tls_source)" == "letsencrypt" \
        && -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
    log "Reusing Let's Encrypt material already in ${CERT_DIR}"
    return 0
  fi

  # Serve HTTP ACME + app while issuing
  local saved_mode="${MODE}"
  MODE="no-tls"
  render_gateway
  MODE="${saved_mode}"
  compose_up

  log "Requesting Let's Encrypt certificate…"
  if "${COMPOSE[@]}" --profile certbot run --rm --entrypoint certbot certbot \
      certonly --webroot -w /var/www/certbot -d "${DOMAIN}" \
      --non-interactive --agree-tos --email "${EMAIL}"; then
    "${COMPOSE[@]}" --profile certbot run --rm --entrypoint sh certbot -c \
      "cp -L /etc/letsencrypt/live/${DOMAIN}/fullchain.pem /out/fullchain.pem && \
       cp -L /etc/letsencrypt/live/${DOMAIN}/privkey.pem /out/privkey.pem && \
       chmod 644 /out/fullchain.pem && chmod 644 /out/privkey.pem"
    write_tls_source letsencrypt
    log "Installed Let's Encrypt PEMs into ${CERT_DIR} (replaced prior gateway certs)"
  else
    log "Certbot failed — falling back to self-signed. Retry with --certbot later."
    FORCE_SELF_SIGNED=1
    ensure_self_signed
  fi
}

smoke_test() {
  local url code
  if [[ "${MODE}" == "no-tls" ]]; then
    url="http://${DOMAIN}/"
    code="$(curl -fsS -o /dev/null -w '%{http_code}' --resolve "${DOMAIN}:80:127.0.0.1" "${url}" || true)"
  else
    url="https://${DOMAIN}/"
    code="$(curl -kfsS -o /dev/null -w '%{http_code}' --resolve "${DOMAIN}:443:127.0.0.1" "${url}" || true)"
  fi
  if [[ "${code}" == "200" ]]; then
    log "Smoke OK (${code}) → ${url}"
  else
    log "Smoke returned HTTP ${code:-curl-failed}. Check ports 80/443 and DNS."
  fi
}

write_env_hint() {
  local scheme
  if [[ "${MODE}" == "no-tls" ]]; then scheme="http"; else scheme="https"; fi
  # Update DOMAIN/PUBLIC_URL without wiping other secrets operators may have added
  if grep -q '^DOMAIN=' "${SCRIPT_DIR}/.env.production" 2>/dev/null; then
    sed -i.bak "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" "${SCRIPT_DIR}/.env.production" || true
    sed -i.bak "s|^PUBLIC_URL=.*|PUBLIC_URL=${scheme}://${DOMAIN}|" "${SCRIPT_DIR}/.env.production" || true
    rm -f "${SCRIPT_DIR}/.env.production.bak"
  else
    {
      echo "DOMAIN=${DOMAIN}"
      echo "PUBLIC_URL=${scheme}://${DOMAIN}"
    } >> "${SCRIPT_DIR}/.env.production"
  fi
  log "PUBLIC_URL=${scheme}://${DOMAIN} (preserved ${SCRIPT_DIR}/.env.production)"
}

main() {
  parse_args "$@"
  cd "${SCRIPT_DIR}"
  ensure_env_file
  mkdir -p "${CERT_DIR}"

  case "${MODE}" in
    no-tls)
      log "HTTP-only mode — no certificates will be created."
      # Dummy PEMs so the read-only certs mount never fails if compose always mounts them
      if [[ ! -f "${CERT_DIR}/fullchain.pem" ]]; then
        echo "no-tls-placeholder" > "${CERT_DIR}/fullchain.pem"
        echo "no-tls-placeholder" > "${CERT_DIR}/privkey.pem"
      fi
      render_gateway
      compose_up
      ;;
    self-signed)
      ensure_self_signed
      render_gateway
      compose_up
      ;;
    certbot)
      ensure_placeholder_certs
      ensure_certbot
      render_gateway
      compose_up
      ;;
  esac

  write_env_hint
  smoke_test
  log "Done. Host nginx was not modified."
  log "Re-run with the same mode to upgrade; certs reuse unless --force-*."
}

main "$@"
