---
"@convex-dev/better-auth": patch
---

pr: #478

Keep the Convex connection signed in when a token request fails for a reason other than a 401, such as a network error when a laptop wakes from sleep.
