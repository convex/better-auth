# Developing guide

## Running locally

```sh
npm i
cd example
npm i
npx convex dev
```

## Testing

Tests require Node 24 or newer (see `.nvmrc`). The upstream Better Auth adapter
suite cannot load on older versions and fails loudly instead of skipping, so a
green run on an older Node is not possible.

```sh
rm -rf dist/ && npm run build
npm run typecheck
npm run test
cd example
npm run lint
cd ..
```

## Deploying

### Building a one-off package

```sh
rm -rf dist/ && npm run build
npm pack
```

### Deploying a new version

Add CHANGELOG entries under a `## Unreleased` heading as you go. `npm version`
renames that heading to the new version (or adds an empty one if there is no
Unreleased section) and opens CHANGELOG.md in vim for a last edit.

`npm run release` always bumps the patch version. For a minor release, such as
0.13.0, run `npm version minor` instead and publish as below.

```sh
# this will change the version and commit it (if you run it in the root directory)
npm version patch
npm publish --dry-run
# sanity check files being included
npm publish
git push --tags
```
