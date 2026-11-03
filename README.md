# haken

> *Haken* (German): the tick mark you make when something is done.

A simple, self-hosted to-do app that runs as an installable web app (PWA) and
stores everything in your own CalDAV server — [Radicale](https://radicale.org)
first and foremost. No accounts, no cloud, no tracking.

> **Status:** early development. Nothing works yet. Don't point it at data you
> care about.

## Goals

- **Trivial to use.** Lists, tasks, done. A familiar layout inspired by the
  well-known list-based to-do apps — but its own design, code and assets.
- **Installable.** A regular website you can add to your phone's home screen.
- **Offline first.** Works without a connection; syncs back when one is
  available.
- **Your server is the source of truth.** State lives in CalDAV `VTODO`s on
  your Radicale instance. Use haken's own sync, or let
  [DAVx⁵](https://www.davx5.com) sync the calendars and point haken at them.
- **No data loss, no data leaks.** Conflicts are surfaced, never silently
  overwritten. Nothing leaves your device except to the server you configured.

## Features (planned)

- [ ] Multiple lists (CalDAV task collections)
- [ ] Manual sort order via drag and drop
- [ ] Descriptions
- [ ] Checklists (sub-steps)
- [ ] Labels
- [ ] Attachments
- [ ] Due dates and reminders
- [ ] "My Day"-style focus view
- [ ] Offline queue with conflict handling
- [ ] Interop with other CalDAV clients (Tasks.org, Thunderbird, …)

## Running it

Not yet. Setup instructions will land here once there is something to run.

## Contributing

Issues and pull requests are welcome once the project is public. See
[CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see
[SECURITY.md](SECURITY.md).

## License

[0BSD](LICENSE) — do whatever you want with it. No warranty, no liability.
