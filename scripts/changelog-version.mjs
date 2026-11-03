#!/usr/bin/env node
// Run by the `version` npm script. Gives the release its CHANGELOG heading:
// renames an existing `## Unreleased` heading to `## <version>`, or, when
// there is none, adds an empty `## <version>` heading under `# Changelog`
// for the release notes.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
);
const path = join(root, "CHANGELOG.md");
const changelog = readFileSync(path, "utf8");
const heading = `## ${version}`;

if (changelog.split("\n").includes(heading)) {
  console.error(`CHANGELOG.md already has a "${heading}" heading.`);
  process.exit(1);
}

const unreleased = /^## Unreleased$/m;
let updated;
if (unreleased.test(changelog)) {
  updated = changelog.replace(unreleased, heading);
} else {
  const title = /^# Changelog\n/m;
  if (!title.test(changelog)) {
    console.error('CHANGELOG.md has no "# Changelog" title.');
    process.exit(1);
  }
  updated = changelog.replace(title, `# Changelog\n\n${heading}\n`);
}
writeFileSync(path, updated);
