# ADR-20261105: Radicale only in the home network

Status: Proposed

## Decision

- Radicale's host name is reachable only from the home network: the reverse proxy allows only local addresses for it, and the router forwards no port to it.
- No fail2ban. Supersedes the fail2ban rule in [gateway security](ADR-20261105-gateway-security.md).

## Why

- Not exposed to the internet, so there is no password guessing from outside to defend against. fail2ban would be an extra component without benefit.
