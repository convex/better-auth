# Developing guide

## Running locally

```sh
npm ci
npm run dev
```

## Testing

```sh
npm run build
npm run check
npm run test:e2e
```

CI runs the Playwright and local Convex semantics suites after the fast checks. When component APIs change,
regenerate and commit the generated files with `npm run build:codegen`.

## Releases

Include a Changeset for user-visible package changes:

```sh
npx changeset
```

Review the generated version PR before merging it. A bot-created PR may need
its required `Test and lint` check run manually on `changeset-release/main`.
The version PR updates the package version and changelog; merging it stages the
package from that exact commit on `main`. A maintainer then reviews the staged
package on npm and approves with 2FA. The source tag is created only after
staging succeeds.

Configure npm trusted publishing for this package's `release.yml` workflow
before the first CI release. Use the npm package's Settings → Trusted Publisher
page, or run:

```sh
npm trust github @convex-dev/better-auth --repo convex/better-auth --file release.yml --allow-stage-publish
```

To prepare a version PR without the bot, run `npx changeset version`, review
the version, changelog and consumed Changesets, then commit and open a PR.
For recovery, dispatch **Release** with the version-bump commit SHA only after
checking whether that version is already staged on npm.
