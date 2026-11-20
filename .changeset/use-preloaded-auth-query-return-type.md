---
"@convex-dev/better-auth": patch
---

pr: #441

`usePreloadedAuthQuery` is typed as returning `undefined` while the user is signed out, which is what it returns, instead of `null`. Code that annotates the result with `| null` needs `| undefined`.
