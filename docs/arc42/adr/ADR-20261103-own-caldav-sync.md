# ADR-20261103: haken syncs via CalDAV itself

Status: Proposed

## Decision

haken talks CalDAV to Radicale (through the gateway). It does not read data synced by DAVx⁵.

## Why

- DAVx⁵ stores tasks in Android content providers. A web page cannot read them.
- DAVx⁵ keeps working for other apps (Tasks.org) against the same server. haken must tolerate their concurrent edits: no duplicate UIDs, no order ping-pong.
