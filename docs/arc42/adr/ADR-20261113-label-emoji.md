# ADR-20261113: Label emoji kept on the device

Status: Proposed

## Decision

- *Edit label* has an optional *Emoji* field: exactly one emoji (one grapheme with a pictographic or flag character), or empty for none. Anything else is rejected by the field.
- The sidebar shows the emoji instead of the label's tag icon (decorative, `aria-hidden`).
- Stored per account on this device (IndexedDB `state`, key `labelEmoji`, a JSON object label → emoji), never on the server, like the [label order](ADR-20261111-label-order.md).
- Rename moves the emoji; renaming onto a label with its own emoji keeps that one; delete removes it.

## Why

- A label has no resource of its own and no standard carries a symbol for a `CATEGORIES` value; writing one would change other clients' data.
- Same storage and rename rules as the label order: no new mechanism.
