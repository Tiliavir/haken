# Backlog

Work in progress on the current branch. Planned work beyond it is in
[GitHub issues](https://github.com/Tiliavir/haken/issues).

## Sync and store

- List deleted while another client edits one of its tasks: the restored task is hidden and the `deletelist` operation never drains.
- Check the total resource size against the gateway's 32 MiB body limit before attaching. Radicale answers `412`, not `413`, for a resource between `max_resource_size` (80 % of `max_content_length`) and `max_content_length`.
- `413`: stop retrying every run; retry after the task changed.
- Storage quota: warn when `navigator.storage.estimate()` is near the limit.
- Multi-tab: E2E with two tabs of the same account (Web Locks, BroadcastChannel).

## Features

- List colour and list order from the server; reorder lists by drag and drop.

## UI

- Design the screens chapter 8 lists as *Not designed yet*; update the sketches.
- Hidden user-name field in the *Sign in to sync* dialog so password managers fill it.
- Trusted Types with a single policy for the service-worker URL.
- `de-CH` locale.

## Quality gates and delivery

- `make check` in the pinned CI container, locally too.
- Pin images and actions by digest; verify the pinned versions.
- Coverage report (TypeScript and Go) and SonarCloud.
- Type-check the E2E sources with `tsc`.
- Release process: version from the build, changelog, container tags.
