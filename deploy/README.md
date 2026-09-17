# deploy/README.md — short pointer

Full deployment documentation: **[DEPLOYMENT.md](../DEPLOYMENT.md)** (repository root).

## Quick paths

### VM (host nginx)

```bash
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --no-tls
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --self-signed
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --certbot --email you@example.com
```

Owns only `/opt/dictation`, `sites-available/dictation.conf`, `/etc/nginx/ssl/dictation/`.

### Container (Compose gateway — does not touch host nginx)

```bash
./deploy/container/deploy.sh --domain dictation.example.com --no-tls
./deploy/container/deploy.sh --domain dictation.example.com --self-signed
./deploy/container/deploy.sh --domain dictation.example.com --certbot --email you@example.com
```

### Validate

```bash
./deploy/validate.sh --base http://dictation.example.com
./deploy/validate.sh --base https://dictation.example.com --insecure
```
