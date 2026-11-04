# haken

> *Haken* (German): the tick mark you make when something is done.

A simple, self-hosted to-do app that runs as an installable web app (PWA) and
stores everything in your own CalDAV server — [Radicale](https://radicale.org)
first and foremost. No accounts, no cloud, no tracking.

> **Status:** early development. The first version works end to end, but it
> has not been used with real data yet. Don't point it at data you care about.

## Goals

- **Trivial to use.** Lists, tasks, done. A familiar layout inspired by the
  well-known list-based to-do apps — but its own design, code and assets.
- **Installable.** A regular website you can add to your phone's home screen.
- **Offline first.** Works without a connection; syncs back when one is
  available.
- **Your server is the source of truth.** State lives in CalDAV `VTODO`s on
  your Radicale instance. haken syncs them itself; other clients
  ([DAVx⁵](https://www.davx5.com) with Tasks.org, Thunderbird, …) can keep
  using the same server alongside it.
- **No data loss, no data leaks.** Conflicts are merged; an overwritten value
  is kept visibly on the task, never dropped silently. Nothing leaves your device except to the server you configured.

## Features

- [x] Multiple lists (CalDAV task collections)
- [x] Manual sort order via drag and drop (and keyboard)
- [x] Descriptions
- [x] Checklists (sub-steps)
- [x] Labels
- [x] Attachments (inline, up to 5 MB)
- [x] Due dates — reminders are still open
- [x] Repeating tasks (daily, weekdays, weekly, monthly, yearly, custom)
- [x] Focus: due and overdue first (overdue in red), then the tasks you put there — they stay until you take them off
- [x] Smart lists: Important, Planned, All
- [x] Offline queue with conflict handling
- [x] Interop with other CalDAV clients (Tasks.org, Thunderbird, …) — tested with synthetic samples so far
- [x] Browser-only mode without a server, `.ics` export and import
- [x] English, German, French, Spanish, Italian; light and dark; custom accent

## Running it

Locally (needs Node 22, Go 1.24 and `pip install radicale`):

```sh
npm ci
make run        # http://127.0.0.1:8080, user dev / password dev
```

On a server: build the container from [`deploy/Dockerfile`](deploy/Dockerfile)
and run it next to Radicale as in [`deploy/compose.yml`](deploy/compose.yml),
behind a reverse proxy that terminates TLS. See
[chapter 7](docs/arc42/07-deployment-view.md).

## Contributing

Issues and pull requests are welcome once the project is public. See
[CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see
[SECURITY.md](SECURITY.md).

## License

[0BSD](LICENSE) — do whatever you want with it. No warranty, no liability.
