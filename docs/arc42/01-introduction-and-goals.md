# 1. Introduction and Goals

haken is an installable to-do PWA. State lives as `VTODO`s in the user's Radicale.

## Requirements

- Lists, tasks, description, steps (checklist), labels, attachments, due dates.
- Manual order by drag and drop.
- Works offline for days; syncs when the server is reachable.

## Quality goals

| Prio | Goal | Means |
| --- | --- | --- |
| 1 | No data loss | Local write before UI success; conditional server writes; merge, never overwrite |
| 2 | No data leak | Only the user's server is contacted; no credentials in browser storage |
| 3 | Simplicity | Few, stable dependencies; platform APIs and standards; explicit code |
| 4 | Efficiency | Slim backend, small static frontend |
| 5 | Interoperability | Valid `VTODO`s for Tasks.org, Thunderbird, DAVx⁵ |
