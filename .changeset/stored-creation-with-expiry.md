---
"@convex-dev/better-auth": patch
---

Allow a stored `createdAt` range alongside an indexed range such as `expiresAt`. The adapter applies the indexed bounds first and filters by the stored creation timestamp.
