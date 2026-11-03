# Security Policy

haken handles personal task data and server credentials, so security reports
are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository instead.

Include what you found, how to reproduce it, and what impact you expect.
This is a hobby project maintained in spare time — expect a response on a
best-effort basis.

## Scope

Of particular interest:

- Anything that could send task data or credentials anywhere other than the
  user's configured CalDAV server
- Ways to lose or corrupt data during sync or conflict resolution
- XSS or injection via task content, attachments or iCalendar data

## No warranty

As stated in the [license](LICENSE), this software is provided as is,
without warranty of any kind.
