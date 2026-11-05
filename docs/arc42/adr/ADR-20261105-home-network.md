# ADR-20261105: Home network deployment

Status: Proposed

## Decision

- Gateway and Radicale are reachable only from the home network: the reverse proxy allows only local addresses, and the router forwards no port. Away from home the server is unreachable and haken works offline until the device is back.
- No fail2ban. Supersedes the fail2ban rule in [gateway security](ADR-20261105-gateway-security.md).
- Internet exposure is not part of the reference deployment. It needs no code change; whoever exposes haken adds brute-force protection in front of both host names (e.g. reverse-proxy rate limit or fail2ban on Radicale's failed-login log line).

## Why

- Nothing is exposed to the internet, so there is no password guessing from outside to defend against. fail2ban would be an extra component without benefit.
- Keeping protection in the reverse proxy leaves the internet case open without designing for it now.
