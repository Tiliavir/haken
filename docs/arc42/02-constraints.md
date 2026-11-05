# 2. Constraints

| Constraint | Consequence |
| --- | --- |
| Radicale is the single source of truth | CalDAV (RFC 4791) + iCalendar (RFC 5545) is the data contract |
| Web app, installable as PWA | Browser APIs only on the client; no native Android access |
| Self-hosted on a Synology NAS (Docker) | Small footprint; one container besides Radicale |
| Server reachable only in the home network ([ADR](adr/ADR-20261105-home-network.md)) | "Offline" means the server is unreachable, e.g. for days while away from home |
| Original design, code and assets | No copied UI, icons or names from other to-do apps |
| Public open source (0BSD) later | No secrets or real data in the repo |
