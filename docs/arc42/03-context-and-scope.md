# 3. Context and Scope

```
 [haken PWA] --HTTPS--> [haken gateway] --HTTP, internal--> [Radicale]
                                                                ^
 [Tasks.org + DAVx⁵, Thunderbird, ...] --HTTPS, own host name---+
```

| Partner | Interface | Note |
| --- | --- | --- |
| User's browser | HTTPS: static app, `/api/session`, `/dav` proxy (session cookie only) | |
| Radicale | CalDAV | Behind the reverse proxy; the only server state |
| Other CalDAV clients | CalDAV to Radicale directly, Basic auth | Edit the same `VTODO`s concurrently ([gateway security](adr/ADR-20261105-gateway-security.md)) |
