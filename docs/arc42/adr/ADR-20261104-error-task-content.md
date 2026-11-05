# ADR-20261104: Error tasks may contain task values

Status: Accepted

Supersedes the content rule in [ADR-20261104-strict-errors](ADR-20261104-strict-errors.md) (*Never in an error task*).

## Decision

- An error task may contain task values (titles, descriptions, labels, property values) when they help to analyse the error.
- Still never in an error task: passwords, cookies, `Authorization` headers, session ids, tokens and query strings. Context keys matching these are dropped; query strings are cut from every text.

## Why

- Error tasks stay in the user's own CalDAV store, the only place they are written. The value that broke a rule is often the fastest way to the cause.
- The user decides what to strip before copying an error task into a bug report. Credentials are different: they must not land in any store, not even the user's own.
