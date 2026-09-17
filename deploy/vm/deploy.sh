#!/usr/bin/env bash
# VM deploy for dictation (static Vite SPA) behind host nginx FrontendGateway.
# Owns ONLY: /opt/dictation, sites-available/dictation.conf (+ enable symlink),
#            /etc/nginx/ssl/dictation/, /var/www/certbot (shared ACME webroot).
# Does NOT delete other sites-enabled entries or run certbot --nginx.
set -euo pipefail

APP_NAME="dictation"
APP_DIR="/opt/${APP_NAME}"
WWW_DIR="${APP_DIR}/www"
SSL_DIR="/etc/nginx/ssl/${APP_NAME}"
LE_DIR=""
TLS_SOURCE_FILE="${SSL_DIR}/.tls-source"
NGINX_AVAILABLE="/etc/nginx/sites-available/${APP_NAME}.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}.conf"
BACKUP_DIR="/var/backups/${APP_NAME}"
ACME_WEBROOT="/var/www/certbot"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

DOMAIN=""
EMAIL=""
MODE="" # no-tls | self-signed | certbot
FORCE_SELF_SIGNED=0
FORCE_CERTBOT=0
SKIP_BUILD=0
REMOVE_DEFAULT_SITE=0

usage() {
  cat <<EOF
Usage: sudo $0 --domain <host> (--no-tls | --self-signed | --certbot --email <addr>) [options]

Required (pick one TLS mode):
  --no-tls                 HTTP-only verify mode (no certificates)
  --self-signed            HTTPS with openssl PEMs in ${SSL_DIR}
  --certbot                HTTPS with Let's Encrypt (webroot); requires --email

Options:
  --domain <host>          Public hostname (server_name)
  --email <addr>           Let's Encrypt account email (with --certbot)
  --force-self-signed      Replace existing certs with new self-signed
  --force-certbot          Force renew / re-issue Let's Encrypt
  --skip-build             Reuse existing ${WWW_DIR} (no npm build)
  --skip-certbot           Alias for --self-signed
  --remove-default-site    Disable sites-enabled/default only (opt-in)
  -h, --help               Show help

Examples:
  sudo $0 --domain dictation.example.com --no-tls
  sudo $0 --domain dictation.example.com --self-signed
  sudo $0 --domain dictation.example.com --certbot --email you@example.com
EOF
}

log() { printf '[%s] %s\n' "${APP_NAME}" "$*"; }
die() { printf '[%s] ERROR: %s\n' "${APP_NAME}" "$*" >&2; exit 1; }

need_root() {
  [[ "${EUID}" -eq 0 ]] || die "Run as root (sudo)."
}

write_tls_source() { mkdir -p "${SSL_DIR}"; echo "$1" > "${TLS_SOURCE_FILE}"; }
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
      --skip-build) SKIP_BUILD=1; shift ;;
      --remove-default-site) REMOVE_DEFAULT_SITE=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown argument: $1" ;;
    esac
  done

  [[ -n "${DOMAIN}" ]] || die "--domain is required"
  [[ -n "${MODE}" ]] || die "Choose --no-tls, --self-signed, or --certbot"
  if [[ "${MODE}" == "certbot" && -z "${EMAIL}" ]]; then
    die "--certbot requires --email"
  fi
  LE_DIR="/etc/letsencrypt/live/${DOMAIN}"
}

ensure_packages() {
  if ! command -v nginx >/dev/null 2>&1; then
    die "nginx not found. Install nginx before deploying."
  fi
  if [[ "${MODE}" != "no-tls" ]] && ! command -v openssl >/dev/null 2>&1; then
    die "openssl not found (needed for self-signed / fallback)."
  fi
  if [[ "${MODE}" == "certbot" ]] && ! command -v certbot >/dev/null 2>&1; then
    die "certbot not found. Install certbot or use --self-signed / --no-tls."
  fi
}

backup_owned_nginx() {
  mkdir -p "${BACKUP_DIR}"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  if [[ -f "${NGINX_AVAILABLE}" ]]; then
    cp -a "${NGINX_AVAILABLE}" "${BACKUP_DIR}/${APP_NAME}.conf.${stamp}"
    log "Backed up nginx site → ${BACKUP_DIR}/${APP_NAME}.conf.${stamp}"
  fi
}

render_nginx() {
  local template dest
  mkdir -p "$(dirname "${NGINX_AVAILABLE}")" "${ACME_WEBROOT}"
  if [[ "${MODE}" == "no-tls" ]]; then
    template="${SCRIPT_DIR}/nginx/dictation-http.conf.template"
    dest="${NGINX_AVAILABLE}"
    sed -e "s|__DOMAIN__|${DOMAIN}|g" -e "s|__ROOT__|${WWW_DIR}|g" \
      "${template}" > "${dest}"
  else
    template="${SCRIPT_DIR}/nginx/dictation-tls.conf.template"
    dest="${NGINX_AVAILABLE}"
    sed -e "s|__DOMAIN__|${DOMAIN}|g" \
        -e "s|__ROOT__|${WWW_DIR}|g" \
        -e "s|__SSL_DIR__|${SSL_DIR}|g" \
      "${template}" > "${dest}"
  fi

  ln -sfn "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"

  if [[ "${REMOVE_DEFAULT_SITE}" -eq 1 && -L /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default
    log "Removed sites-enabled/default (opt-in)."
  fi
}

reload_nginx() {
  if ! nginx -t; then
    log "nginx -t failed — attempting restore from latest backup…"
    local latest
    latest="$(ls -1t "${BACKUP_DIR}/${APP_NAME}.conf."* 2>/dev/null | head -1 || true)"
    if [[ -n "${latest}" ]]; then
      cp -a "${latest}" "${NGINX_AVAILABLE}"
      nginx -t && systemctl reload nginx
      die "Deploy aborted; restored previous ${APP_NAME} nginx config."
    fi
    die "nginx -t failed and no backup available."
  fi
  systemctl reload nginx
  log "nginx reloaded."
}

build_and_sync() {
  mkdir -p "${APP_DIR}" "${WWW_DIR}"
  # Preserve any existing secrets under APP_DIR
  if [[ -f "${APP_DIR}/.env.production" ]]; then
    log "Preserving ${APP_DIR}/.env.production"
  fi

  if [[ "${SKIP_BUILD}" -eq 1 ]]; then
    [[ -f "${WWW_DIR}/index.html" ]] || die "--skip-build but ${WWW_DIR}/index.html missing"
    log "Skipping build; reusing ${WWW_DIR}"
    return
  fi

  if ! command -v npm >/dev/null 2>&1; then
    die "npm not found. Install Node.js/npm or copy a prebuilt dist/ into ${WWW_DIR} and use --skip-build."
  fi

  log "Building static site from ${REPO_ROOT}…"
  (
    cd "${REPO_ROOT}"
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
    npm run build
  )

  rsync -a --delete \
    --exclude '.env' --exclude '.env.production' \
    "${REPO_ROOT}/dist/" "${WWW_DIR}/"
  # Keep a copy of deploy docs on the host for operators
  rsync -a \
    --exclude node_modules --exclude dist --exclude .git \
    --exclude .env --exclude .env.production \
    "${REPO_ROOT}/DEPLOYMENT.md" "${APP_DIR}/" 2>/dev/null || true
  log "Synced dist → ${WWW_DIR}"
}

ensure_self_signed() {
  mkdir -p "${SSL_DIR}"
  local cur
  cur="$(current_tls_source)"
  if [[ "${FORCE_SELF_SIGNED}" -ne 1 && "${cur}" == "self-signed" \
        && -f "${SSL_DIR}/fullchain.pem" && -f "${SSL_DIR}/privkey.pem" ]]; then
    log "Reusing existing self-signed certs in ${SSL_DIR}"
    return 0
  fi
  # Replace LE symlinks or missing/forced
  rm -f "${SSL_DIR}/fullchain.pem" "${SSL_DIR}/privkey.pem"
  if ! openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "${SSL_DIR}/privkey.pem" -out "${SSL_DIR}/fullchain.pem" \
    -subj "/CN=${DOMAIN}" \
    -addext "subjectAltName=DNS:${DOMAIN}" 2>/dev/null; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "${SSL_DIR}/privkey.pem" -out "${SSL_DIR}/fullchain.pem" \
      -subj "/CN=${DOMAIN}"
  fi
  write_tls_source self-signed
  log "Installed self-signed certs in ${SSL_DIR}"
}

ensure_certbot() {
  mkdir -p "${SSL_DIR}" "${ACME_WEBROOT}"
  if [[ "${FORCE_CERTBOT}" -ne 1 && "$(current_tls_source)" == "letsencrypt" \
        && -f "${LE_DIR}/fullchain.pem" && -f "${LE_DIR}/privkey.pem" ]]; then
    ln -sfn "${LE_DIR}/fullchain.pem" "${SSL_DIR}/fullchain.pem"
    ln -sfn "${LE_DIR}/privkey.pem" "${SSL_DIR}/privkey.pem"
    write_tls_source letsencrypt
    log "Reusing Let's Encrypt certs for ${DOMAIN}"
    return 0
  fi

  # Ensure HTTP ACME path is live (temporary HTTP site if needed)
  if [[ ! -f "${NGINX_ENABLED}" ]] || ! grep -q acme-challenge "${NGINX_AVAILABLE}" 2>/dev/null; then
    log "Installing temporary HTTP site for ACME…"
    sed -e "s|__DOMAIN__|${DOMAIN}|g" -e "s|__ROOT__|${WWW_DIR}|g" \
      "${SCRIPT_DIR}/nginx/dictation-http.conf.template" > "${NGINX_AVAILABLE}"
    ln -sfn "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"
    nginx -t && systemctl reload nginx
  fi

  if certbot certonly --webroot -w "${ACME_WEBROOT}" -d "${DOMAIN}" \
      --non-interactive --agree-tos --email "${EMAIL}"; then
    ln -sfn "${LE_DIR}/fullchain.pem" "${SSL_DIR}/fullchain.pem"
    ln -sfn "${LE_DIR}/privkey.pem" "${SSL_DIR}/privkey.pem"
    write_tls_source letsencrypt
    log "Let's Encrypt installed; gateway points at ${LE_DIR}"
  else
    log "Certbot failed — falling back to self-signed. Retry later with --certbot."
    FORCE_SELF_SIGNED=1
    ensure_self_signed
  fi
}

smoke_test() {
  local url
  if [[ "${MODE}" == "no-tls" ]]; then
    url="http://${DOMAIN}/"
    log "Smoke: curl -fsS -o /dev/null -w '%{http_code}' --resolve ${DOMAIN}:80:127.0.0.1 ${url}"
    code="$(curl -fsS -o /dev/null -w '%{http_code}' --resolve "${DOMAIN}:80:127.0.0.1" "${url}" || true)"
  else
    url="https://${DOMAIN}/"
    log "Smoke: curl -kfsS … ${url}"
    code="$(curl -kfsS -o /dev/null -w '%{http_code}' --resolve "${DOMAIN}:443:127.0.0.1" "${url}" || true)"
  fi
  if [[ "${code}" == "200" ]]; then
    log "Smoke OK (${code}) → ${url}"
  else
    log "Smoke returned HTTP ${code:-curl-failed}. Check DNS / firewall / nginx."
  fi
}

write_public_url() {
  local scheme
  if [[ "${MODE}" == "no-tls" ]]; then scheme="http"; else scheme="https"; fi
  mkdir -p "${APP_DIR}"
  cat > "${APP_DIR}/.env.production.public" <<EOF
DOMAIN=${DOMAIN}
PUBLIC_URL=${scheme}://${DOMAIN}
TLS_MODE=${MODE}
EOF
  log "Wrote ${APP_DIR}/.env.production.public (PUBLIC_URL=${scheme}://${DOMAIN})"
}

main() {
  need_root
  parse_args "$@"
  ensure_packages
  backup_owned_nginx
  build_and_sync

  case "${MODE}" in
    no-tls)
      log "HTTP-only mode — no certificates will be created."
      ;;
    self-signed)
      ensure_self_signed
      ;;
    certbot)
      ensure_certbot
      ;;
  esac

  render_nginx
  reload_nginx
  write_public_url
  smoke_test
  log "Done. Owned nginx site: ${NGINX_AVAILABLE}"
  log "Re-run safely with the same mode to upgrade files; certs reuse unless --force-*."
}

main "$@"
