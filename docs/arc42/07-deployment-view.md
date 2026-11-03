# 7. Deployment View

## Self-hosted (Synology NAS, Docker Compose)

```
 Browser / installed PWA
        |
        | HTTPS :443
        v
 [DSM reverse proxy]  TLS, Let's Encrypt certificate
        |
        | HTTP, NAS-local only
        v
 [container: haken gateway]  :8080   static app, /api/session, /dav proxy
        |
        | HTTP, Compose network only (no published port)
        v
 [container: radicale]       :5232 ---- volume: collections (the only state)
```

| Element | Configuration | Note |
| --- | --- | --- |
| DSM reverse proxy | Host name → `localhost:8080`; HSTS on | Terminates TLS; the gateway sets `Secure` cookies and trusts `X-Forwarded-Proto` only from it |
| haken gateway | One static Go binary in a `scratch` image; Radicale URL and listen address from the environment; app and `config.json` embedded | Stateless; restart ends all sessions ([Auth](adr/ADR-20261103-authentication.md)) |
| Radicale | Official image; `htpasswd` (bcrypt), `rights = owner_only`; no published port | Reached only by the gateway |
| Volume `collections` | Bind mount on the NAS | Included in the NAS backup (e.g. Hyper Backup). This is the server copy of all tasks |

Updates: pull new images, `docker compose up -d`. The PWA's service worker picks up the new app shell on the next start.

How other CalDAV clients reach Radicale, and where TLS ends, is under review in [`OPEN.md`](../../OPEN.md).

## Demo (GitHub Pages)

| Element | Configuration |
| --- | --- |
| Static build | Deployed by GitHub Actions after all quality gates pass; `config.json` with `"accounts": ["local"]`; served under `/haken/` |
| Backend | None ([Browser-only](adr/ADR-20261103-browser-only-mode.md)) |
