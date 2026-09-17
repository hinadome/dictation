# Deployment

## Stack classification

**Static Vite SPA** — no TanStack Start, no Nitro SSR. Hosting must publish `dist`.

| Platform | Publish | Server functions |
|---|---|---|
| Vercel | `dist` (`vercel.json` → `outputDirectory`) | None |
| Netlify | `dist` (`netlify.toml` → `publish`) | None — do **not** use `dist/client` + `dist/server` |

## Config files

- `vercel.json` — Vite framework, build command, SPA rewrite, COOP/COEP headers
- `netlify.toml` — build command, `publish = "dist"`, SPA redirect to `/index.html`, same headers

## Build verification

```bash
npm run build:vercel    # or build:netlify — identical for this SPA
ls dist/index.html      # must exist
ls dist/assets          # JS/CSS/WASM bundles
```

There is no `dist/nitro.json` or `dist/server/main.mjs` for this project.

## HTTPS requirement

Browser mic / display-media APIs need a secure context. Localhost and Vercel/Netlify HTTPS both qualify.
