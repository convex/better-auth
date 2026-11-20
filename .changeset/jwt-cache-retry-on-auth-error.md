---
"@convex-dev/better-auth": patch
---

pr: #440

With `jwtCache`, the Next.js and TanStack Start helpers get a new token and retry a call only when Convex rejected the token. A call that failed for another reason is no longer run a second time.
