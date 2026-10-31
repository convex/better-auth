import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const fixture = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixture, "../..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "better-auth-upgrade-"));
const app = path.join(scratch, "verification-app");
// Never rewrite the checkout or ship the adversarial test mutations in src/.
try {
  fs.cpSync(path.join(root, "src"), path.join(scratch, "src"), {
    recursive: true,
  });
  for (const file of ["package.json", "tsconfig.json", "tsconfig.build.json"])
    fs.copyFileSync(path.join(root, file), path.join(scratch, file));
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(scratch, "node_modules")
  );
  fs.cpSync(path.join(fixture, "convex"), path.join(app, "convex"), {
    recursive: true,
  });
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(app, "node_modules")
  );
  fs.renameSync(
    path.join(app, "convex/probe.ts.fixture"),
    path.join(app, "convex/probe.ts")
  );
  fs.copyFileSync(
    path.join(fixture, "verification.ts.fixture"),
    path.join(scratch, "src/component/verification.ts")
  );
  fs.copyFileSync(
    path.join(fixture, "verify.mjs"),
    path.join(app, "verify.mjs")
  );
  fs.writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { convex: "1.46.0" },
    })
  );
  fs.copyFileSync(
    path.join(root, "src/component/schema.ts"),
    path.join(app, "managed-schema-original.ts.txt")
  );
  fs.copyFileSync(
    path.join(fixture, "convex/legacy-schema.ts.fixture"),
    path.join(app, "legacy-schema.ts.txt")
  );
  const result = spawnSync(
    process.execPath,
    [path.join(root, "e2e/backendHarness.js"), "node verify.mjs"],
    {
      cwd: app,
      stdio: "inherit",
      env: { ...process.env, DISABLE_BEACON: "true", CI: "true" },
    }
  );
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
