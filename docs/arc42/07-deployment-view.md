# 7. Deployment View

## Self-hosted (Synology NAS, Docker Compose)

```
 Browser / installed PWA              Other CalDAV clients (DAVx⁵, Thunderbird)
        |                                     |
        | HTTPS :443, app host name           | HTTPS :443, Radicale host name
        v                                     v
 [DSM reverse proxy]  TLS, Let's Encrypt certificates
        |                                     |
        | HTTP, 127.0.0.1:8080                | HTTP, 127.0.0.1:5232
        v                                     |
 [container: haken gateway]                   |
   static app, /api/session, /dav proxy       |
        |                                     |
        | HTTP, Compose network               |
        v                                     v
 [container: radicale]  :5232 ---- volume: collections (the only state)
```

| Element | Configuration | Note |
| --- | --- | --- |
| DSM reverse proxy | App host name → `localhost:8080`; Radicale host name → `localhost:5232` with custom header `X-Forwarded-For: $remote_addr`; HSTS on | Terminates TLS. The gateway reads no `X-Forwarded-*` header; its session cookie is always `Secure` (`__Host-`) |
| haken gateway | One static Go binary in a `scratch` image; Radicale URL and listen address from the environment; app and `config.json` embedded | Stateless; restart ends all sessions ([Auth](adr/ADR-20261103-authentication.md)) |
| Radicale | Official image; `htpasswd` (bcrypt), `rights = owner_only`; port published on `127.0.0.1` only | Reached by the gateway (session users) and through the reverse proxy (Basic auth, other clients) |
| fail2ban | [`deploy/fail2ban/`](../../deploy/fail2ban/) in fail2ban's `filter.d` and `jail.d`; reads the Docker container logs | 5 failed Radicale logins in 10 min from one client address (last `X-Forwarded-For` entry) → banned from `https` for 1 h |
| Volume `collections` | Bind mount on the NAS | Included in the NAS backup (e.g. Hyper Backup). This is the server copy of all tasks |

Files: [`deploy/Dockerfile`](../../deploy/Dockerfile), [`deploy/compose.yml`](../../deploy/compose.yml), [`deploy/radicale.config.example`](../../deploy/radicale.config.example), [`deploy/fail2ban/`](../../deploy/fail2ban/). Gateway environment: `HAKEN_RADICALE_URL` (required), `HAKEN_LISTEN` (default `:8080`), `HAKEN_SESSION_IDLE` (default `168h`).

Updates: pull new images, `docker compose up -d`. The PWA's service worker picks up the new app shell on the next start.

`/dav` accepts only the app's session cookie; Basic auth there is refused with `401`. Other CalDAV clients use Radicale's host name ([gateway security](adr/ADR-20261105-gateway-security.md)).

## Demo (GitHub Pages)

| Element | Configuration |
| --- | --- |
| Static build | `make build-demo`, deployed by GitHub Actions after all quality gates pass; `config.json` from `web/config/demo.json` (`"accounts": ["local"], "demo": true`); served under `/haken/` |
| Backend | None ([Browser-only](adr/ADR-20261103-browser-only-mode.md)) |
