# Security Policy

## Reporting a vulnerability

Please don't open a public issue for security reports.

Email **security@convex.dev** with:

- a description of the issue and its impact
- steps to reproduce, ideally a minimal example
- the affected version
- any mitigation you'd suggest

We aim to respond within 24 hours, per the
[Convex vulnerability disclosure policy](https://www.convex.dev/security).
Please give us a chance to address the issue before disclosing it publicly.

## Where to report

This package is the Convex adapter for Better Auth, so a report may belong to one
of three projects:

| Issue is in                                                               | Report to                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| This package: the Convex adapter, the component, or the framework helpers | security@convex.dev                                                                          |
| Better Auth itself: core auth flows, plugins, session handling            | [Better Auth advisories](https://github.com/better-auth/better-auth/security/advisories/new) |
| The Convex platform: backend, dashboard, or hosted infrastructure         | security@convex.dev                                                                          |

If you aren't sure, send it to security@convex.dev and we'll route it.

## Supported versions

Fixes ship in a new release. Please check your report against the latest
published version before sending it.
