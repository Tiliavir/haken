# 3. Context and Scope

```
 [haken PWA] --HTTPS--> [haken gateway] --HTTP, internal--> [Radicale]
                              ^
 [Tasks.org + DAVx⁵,          |
  Thunderbird, ...] ---HTTPS--+   (optional, same data)
```

| Partner | Interface | Note |
| --- | --- | --- |
| User's browser | HTTPS: static app + `/dav` proxy | Only exposed endpoint |
| Radicale | CalDAV over internal network | Never exposed directly |
| Other CalDAV clients | CalDAV via the gateway | Edit the same `VTODO`s concurrently |
