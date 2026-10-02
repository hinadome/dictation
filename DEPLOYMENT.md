# Deployment

Detailed VM and Container deployment for **dictation** (static Vite SPA) behind an **nginx FrontendGateway**.

Paired short pointer: [`deploy/README.md`](./deploy/README.md).  
Platform-as-a-service (Vercel/Netlify) notes remain in [`docs/deployment.md`](./docs/deployment.md).

---

## Overview

| Path | What runs | Gateway | Touches host nginx? |
|---|---|---|---|
| **VM** | Static files in `/opt/dictation/www` | Host nginx site `dictation.conf` | **Yes** — only this app’s site file |
| **Container** | Compose `app` (nginx:8080) + `gateway` (80/443) | Compose nginx | **No** |

VM and Container scripts are **separate** (`deploy/vm/deploy.sh` vs `deploy/container/deploy.sh`). Do not merge them.

Architecture (both paths):

```text
Client ──► nginx FrontendGateway ──► static dictation assets
              :80 / :443                 (VM: disk) / (Container: app:8080)
```

There is no Node.js runtime in production; Vite builds static HTML/JS/WASM.

Two in-browser features lazy-load models from **Hugging Face** on first use and
then run locally: **Whisper** (system-audio dictation) and the **Text to Speech
→ Download audio (WAV)** path (transformers.js MMS/VITS). Both rely on the
COOP/COEP WASM headers the nginx templates already send; the client needs
outbound HTTPS to Hugging Face to fetch a model the first time (cached after).

---

## Prerequisites

### Shared

- DNS `A`/`AAAA` for your domain pointing at the host (required for Certbot)
- Ports **80** (and **443** for HTTPS) reachable for public TLS modes
- `curl`, `openssl` (HTTPS modes)

### VM

- Root/sudo
- `nginx` installed
- `npm`/Node 20+ to build on the server **or** a prebuilt `dist/` + `--skip-build`
- `certbot` when using `--certbot`
- Debian/Ubuntu-style `sites-available` / `sites-enabled` layout

### Container

- Docker Engine + `docker compose`
- Ability to publish host ports 80/443 (via the Docker daemon — the container
  processes themselves run **non-root**; see [Rootless / non-root](#rootless--non-root-docker))
- Does **not** require or modify host nginx

---

## Architecture / ports

### HTTPS modes (`--self-signed` / `--certbot`)

| Public (nginx) | Protocol | Upstream |
|---|---|---|
| `443` | HTTPS | Static files (VM) or `app:8080` (Container) |
| `80` | HTTP | ACME webroot + redirect to HTTPS |

### Verify mode (`--no-tls`)

| Public (nginx) | Protocol | Upstream |
|---|---|---|
| `80` | HTTP (no redirect, no certs) | Static files / `app:8080` |

---

## VM deployment

Script: [`deploy/vm/deploy.sh`](./deploy/vm/deploy.sh)

### Verify without certificates (`--no-tls`)

```bash
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --no-tls
./deploy/validate.sh --base http://dictation.example.com
```

- Installs HTTP-only site template (no `ssl_certificate`)
- Creates **no** certificates
- Sets `PUBLIC_URL=http://dictation.example.com`

### HTTPS with self-signed (`--self-signed`)

```bash
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --self-signed
./deploy/validate.sh --base https://dictation.example.com --insecure
```

- Writes PEMs under `/etc/nginx/ssl/dictation/` (never under `/etc/letsencrypt/live/`)
- Reuses existing self-signed on re-run unless `--force-self-signed`

### HTTPS with Certbot (`--certbot`)

```bash
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --certbot --email you@example.com
```

- Uses **certbot webroot** (`/var/www/certbot`) — **not** `certbot --nginx`
- On success, symlinks LE certs into `/etc/nginx/ssl/dictation/` and sets `.tls-source=letsencrypt`
- On failure, falls back to self-signed and prints retry guidance

### Repeatable upgrade (re-run)

```bash
# Same mode → rebuild/sync www, reload nginx; reuse certs
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --self-signed
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --self-signed --skip-build
```

### Script flags

| Flag | Meaning |
|---|---|
| `--domain` | Required `server_name` |
| `--no-tls` | HTTP-only verify |
| `--self-signed` / `--skip-certbot` | Self-signed HTTPS |
| `--force-self-signed` | Replace gateway certs with new self-signed |
| `--certbot` | Let's Encrypt (needs `--email`) |
| `--force-certbot` | Force re-issue |
| `--email` | LE account email |
| `--skip-build` | Keep existing `/opt/dictation/www` |
| `--remove-default-site` | Opt-in: disable `sites-enabled/default` only |

### Files this deploy owns

| Path | Role |
|---|---|
| `/opt/dictation/www/` | Built static site |
| `/opt/dictation/.env.production.public` | Written `PUBLIC_URL` hint |
| `/etc/nginx/sites-available/dictation.conf` | This app’s vhost only |
| `/etc/nginx/sites-enabled/dictation.conf` | Symlink enable |
| `/etc/nginx/ssl/dictation/` | Gateway PEMs + `.tls-source` |
| `/var/backups/dictation/` | Backups of owned nginx site before overwrite |
| `/var/www/certbot/` | Shared ACME webroot |

### What this deploy will NOT touch

- Other `sites-enabled/*` entries (no mass delete)
- Unrelated vhosts or stream configs
- `/etc/letsencrypt/live/` contents for writing self-signed material
- `ufw --force enable`
- Foreign app directories under `/opt`

---

## Container deployment

Script: [`deploy/container/deploy.sh`](./deploy/container/deploy.sh)  
Compose: [`deploy/container/docker-compose.yml`](./deploy/container/docker-compose.yml)

### Verify without certificates (`--no-tls`)

```bash
./deploy/container/deploy.sh --domain dictation.example.com --no-tls
./deploy/validate.sh --base http://127.0.0.1
```

### HTTPS with self-signed (`--self-signed`)

```bash
./deploy/container/deploy.sh --domain dictation.example.com --self-signed
./deploy/validate.sh --base https://dictation.example.com --insecure
```

Certs live in `deploy/container/certs/` (gitignored PEMs) with `.tls-source`.

### HTTPS with Certbot (`--certbot`)

```bash
./deploy/container/deploy.sh --domain dictation.example.com --certbot --email you@example.com
```

1. Brings up HTTP gateway for ACME  
2. Runs Certbot webroot in Compose profile `certbot`  
3. Copies LE PEMs into `deploy/container/certs/` (replaces prior self-signed)  
4. Switches gateway to TLS config and recreates services  

### Repeatable upgrade (re-run)

```bash
./deploy/container/deploy.sh --domain dictation.example.com --self-signed
./deploy/container/deploy.sh --domain dictation.example.com --self-signed --no-build
```

Preserves `deploy/container/.env.production` across runs.

### Compose services

| Service | Role | Container user | Internal listen | Published ports |
|---|---|---|---|---|
| `app` | Static SPA (`nginxinc/nginx-unprivileged`) | non-root (UID 101) | `8080` | none (internal only) |
| `gateway` | FrontendGateway TLS/HTTP (`nginxinc/nginx-unprivileged`) | non-root (UID 101) | `8080` / `8443` | host `80→8080`, `443→8443` |
| `certbot` | Profile `certbot` only | root (short-lived) | — | none |

Both long-running services run as a **non-root** user. The gateway listens on
unprivileged ports **8080/8443** inside the container; Docker maps the host's
`80`/`443` onto them, so no process binds a privileged port.

Both pin the image **`nginxinc/nginx-unprivileged:1.27.0-alpine3.19-slim`** for
reproducible builds.

### What this deploy will NOT touch

- Host `/etc/nginx/nginx.conf` or `sites-enabled`
- Unrelated Docker Compose projects
- Host systemd units

### Rootless / non-root Docker

The container images and the deploy script do **not** require `sudo`.

**Inside the containers (always non-root):** both `app` and `gateway` use
`nginxinc/nginx-unprivileged` and run as UID **101**. The gateway listens on
**8080/8443**; Compose maps host `80→8080` and `443→8443`. Certificate PEMs are
written world-readable (`644`) so the non-root nginx user can read them through
the read-only `:ro` mount.

**On the host — avoid `sudo` with one of:**

1. **Add your user to the `docker` group** (talk to the daemon without `sudo`):

   ```bash
   sudo usermod -aG docker "$USER"   # one-time, by an admin
   newgrp docker                     # or log out/in
   ./deploy/container/deploy.sh --domain dictation.example.com --no-tls
   ```

   > Note: membership in the `docker` group is root-equivalent on that host.

2. **Rootless Docker** (daemon runs as your user; strongest isolation):

   ```bash
   dockerd-rootless-setuptool.sh install
   export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
   ```

   Rootless mode binds privileged ports (80/443) by default only if
   `net.ipv4.ip_unprivileged_port_start` allows it, or via the built-in
   `rootlesskit` port driver. If binding 80/443 fails, publish high ports and
   front them (e.g. `8080:8080`, `8443:8443`) or grant the capability:

   ```bash
   sudo setcap cap_net_bind_service=ep "$(which rootlesskit)"
   ```

The VM path still needs root/sudo because it edits host nginx (`sites-available`,
`/etc/nginx/ssl`, reload). Use the **Container** path for a no-root deployment.

---

## HTTPS and certificates

### Required flags (both scripts)

- `--no-tls`
- `--self-signed` / `--force-self-signed`
- `--certbot` / `--force-certbot` / `--email`

### Detection / reuse within the same mode

Marker file: `.tls-source` → `self-signed` | `letsencrypt`

| Prior | Next command | Result |
|---|---|---|
| Self-signed | `--self-signed` again | **Reuse** unless `--force-self-signed` |
| Let's Encrypt | `--certbot` again | **Reuse** unless `--force-certbot` |
| Self-signed | `--certbot` | **Replace** gateway certs with LE on success |
| Let's Encrypt | `--self-signed` | **Replace** with new self-signed (LE files left unused on disk) |
| Any | `--no-tls` | No cert creation; HTTP-only site |

Self-signed material is **never** written into `/etc/letsencrypt/live/`.

### Upgrade path from `--no-tls`

```bash
# After smoke-test succeeds on HTTP:
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --self-signed
# or
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --certbot --email you@example.com

./deploy/container/deploy.sh --domain dictation.example.com --self-signed
# or
./deploy/container/deploy.sh --domain dictation.example.com --certbot --email you@example.com
```

---

## Coexistence

- VM script only writes `dictation.conf` and its enable symlink; it does not wipe other sites.
- Before overwrite, the previous `dictation.conf` is copied to `/var/backups/dictation/`.
- `nginx -t` runs before reload; on failure the script attempts to restore the last backup.
- Container path isolates networking in Compose and never edits host nginx.

---

## Operations

### Status / logs

```bash
# VM
systemctl status nginx
journalctl -u nginx -e
ls -l /etc/nginx/sites-enabled/dictation.conf
cat /etc/nginx/ssl/dictation/.tls-source

# Container
cd deploy/container
docker compose ps
docker compose logs -f gateway app
cat certs/.tls-source
```

### Smoke validate

```bash
./deploy/validate.sh --base http://dictation.example.com
./deploy/validate.sh --base https://dictation.example.com --insecure

# Assert the containers run as a non-root user (UID != 0). Requires Docker;
# run from the host where the Compose project is up.
./deploy/validate.sh --check-nonroot
./deploy/validate.sh --base http://127.0.0.1 --check-nonroot   # both checks
```

`--check-nonroot` runs `docker compose exec <svc> id -u` for `app` and
`gateway` and fails if either reports UID `0`. Expected output:

```text
OK   app: non-root (UID 101)
OK   gateway: non-root (UID 101)
```

### Rollback

- VM: restore a file from `/var/backups/dictation/` to `sites-available/dictation.conf`, then `nginx -t && systemctl reload nginx`
- Container: redeploy a known-good git revision with the same TLS mode flags

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `nginx -t` fails after deploy | Bad template render / missing PEM | Restore backup; ensure certs exist for TLS mode |
| Certbot fails | DNS not pointing here / port 80 blocked | Fix DNS/firewall; retry `--certbot` or use `--self-signed` |
| Browser mic blocked | Not HTTPS (or not localhost) | Use `--self-signed`/`--certbot` or tunnel |
| Container 443 empty | Still on `--no-tls` | Redeploy with `--self-signed` or `--certbot` |
| Whisper / TTS WASM issues | Missing COOP/COEP | Templates already set headers (incl. `.wasm`); hard-refresh |
| Model download fails (Whisper or TTS WAV) | Blocked egress to Hugging Face | Allow outbound HTTPS to `huggingface.co` / `cdn-lfs*`; retry |

---

## Security notes

- Preserve `/opt/dictation/.env.production` and `deploy/container/.env.production` (rsync/deploy exclude secrets; scripts do not `rm` them).
- Prefer firewall allowlists for 80/443 only; do not auto-`ufw --force enable`.
- Self-signed is for lab/verify; use Certbot for public trust.
- SPA still stores transcripts in the **user’s browser** IndexedDB — gateway TLS protects transit only.
