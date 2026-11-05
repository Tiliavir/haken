# Decisions to review

Taken during implementation and not yet reviewed. Accepted ones move into an
ADR and leave this file; the file goes away when it is empty.

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D61 | A `401` from `/dav` during a sync run ends the run as *Sign in to sync* (`ExpiredError`), not as an error or a quarantine. Quarantine records are keyed `quarantine:<href>` (task, list changes) and `quarantine:pull:<href>` (reading a list), so a working pull never releases a failed list change. | The probe only checks the session at the start; it can expire mid-run. Separate keys stop an error task per run for a list whose `PROPPATCH` keeps failing. | `net/http.ts`, `sync/runner.ts` |
