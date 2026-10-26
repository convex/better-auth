// Run a command against a fresh local backend, handling setup and teardown.
// Downloads the latest prebuilt Convex local backend binary if needed.
//
// Adapted from https://github.com/get-convex/convex-auth/blob/main/test-nextjs/backendHarness.js

import http from "node:http";
import fsPromises from "node:fs/promises";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, unlinkSync, rmSync, chmodSync } from "node:fs";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");

const backendCloudPort = 3210;
const backendSitePort = 3211;
const parsedUrl = new URL(`http://127.0.0.1:${backendCloudPort}`);

function logToStderr(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

async function isBackendRunning(backendUrl) {
  return new Promise((resolve) => {
    http
      .request(
        {
          hostname: backendUrl.hostname,
          port: backendUrl.port,
          path: "/version",
          method: "GET",
        },
        (res) => {
          resolve(res.statusCode === 200);
        },
      )
      .on("error", () => {
        resolve(false);
      })
      .end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let backendProcess = null;

const waitForLocalBackendRunning = async (backendUrl) => {
  let isRunning = await isBackendRunning(backendUrl);
  let i = 0;
  while (!isRunning) {
    if (i % 10 === 0) {
      logToStderr("Waiting for backend to be running...");
    }
    await sleep(500);
    isRunning = await isBackendRunning(backendUrl);
    const isDead = backendProcess.exitCode !== null;
    if (isDead) {
      throw new Error("Backend exited unexpectedly");
    }
    i += 1;
  }
};

function cleanup() {
  if (backendProcess !== null) {
    logToStderr("Cleaning up running backend");
    backendProcess.kill("SIGTERM");
    rmSync("convex_local_storage", { recursive: true, force: true });
    rmSync("convex_local_backend.sqlite3", { force: true });
  }
}

function getDownloadPath() {
  switch (process.platform) {
    case "darwin":
      if (process.arch === "arm64") {
        return "convex-local-backend-aarch64-apple-darwin.zip";
      } else if (process.arch === "x64") {
        return "convex-local-backend-x86_64-apple-darwin.zip";
      }
      break;
    case "linux":
      if (process.arch === "arm64") {
        return "convex-local-backend-aarch64-unknown-linux-gnu.zip";
      } else if (process.arch === "x64") {
        return "convex-local-backend-x86_64-unknown-linux-gnu.zip";
      }
      break;
    case "win32":
      return "convex-local-backend-x86_64-pc-windows-msvc.zip";
  }
  return null;
}

async function downloadAndStartBackend() {
  const latest = await fetch(
    "https://github.com/convex/convex-backend/releases/latest",
    { redirect: "manual" },
  );
  if (latest.status !== 302) {
    throw new Error(`Error fetching latest release: ${latest.status}`);
  }
  const latestUrl = latest.headers.get("location");
  const version = latestUrl.split("/").pop();
  logToStderr(`Downloading latest backend binary, ${version}`);
  const downloadPath = getDownloadPath();
  if (!downloadPath) {
    throw new Error(
      `Unsupported platform: ${process.platform} ${process.arch}`,
    );
  }
  const response = await fetch(
    `https://github.com/convex/convex-backend/releases/download/${version}/${downloadPath}`,
  );

  const zipLocation = "convex-backend.zip";
  if (existsSync(zipLocation)) {
    unlinkSync(zipLocation);
  }
  const fileHandle = await fsPromises.open(zipLocation, "wx", 0o644);
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      await fileHandle.write(chunk);
    }
  } finally {
    await fileHandle.close();
  }
  logToStderr("Downloaded zip file");

  const zip = new AdmZip(zipLocation);
  zip.extractAllTo(".", true);
  const binaryPath = "./convex-local-backend";
  chmodSync(binaryPath, 0o755);

  const instanceName = "anonymous-convex-better-auth-e2e";
  const instanceSecret = crypto.randomBytes(32).toString("hex");
  const keyResponse = await fetch(
    "https://api.convex.dev/api/local_deployment/generate_admin_key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceName, instanceSecret }),
    },
  );
  if (!keyResponse.ok) {
    throw new Error(
      `Failed to generate admin key: ${keyResponse.status} ${await keyResponse.text()}`,
    );
  }
  const { adminKey } = await keyResponse.json();
  if (typeof adminKey !== "string" || adminKey.length === 0) {
    throw new Error(
      "Provisioning response did not include a valid adminKey",
    );
  }

  const process_ = spawn(
    binaryPath,
    [
      "--port", String(backendCloudPort),
      "--site-proxy-port", String(backendSitePort),
      "--instance-name", instanceName,
      "--instance-secret", instanceSecret,
    ],
    { env: { CONVEX_TRACE_FILE: "1" } },
  );
  return { process: process_, adminKey };
}

async function runWithLocalBackend(command, backendUrl) {
  const isRunning = await isBackendRunning(backendUrl);
  if (isRunning) {
    logToStderr(
      "Local backend is already running. Stop it and restart this command.",
    );
    process.exit(1);
  }

  rmSync("convex_local_storage", { recursive: true, force: true });
  rmSync("convex_local_backend.sqlite3", { force: true });

  const { process: started, adminKey } = await downloadAndStartBackend();
  backendProcess = started;
  backendProcess.stdout.pipe(process.stderr);
  backendProcess.stderr.pipe(process.stderr);

  await waitForLocalBackendRunning(backendUrl);
  logToStderr("Backend running!");
  logToStderr("Running command:", command);

  const code = await new Promise((resolve) => {
    const c = spawn(command, {
      shell: true,
      stdio: "pipe",
      env: { ...process.env, FORCE_COLOR: "1", CONVEX_ADMIN_KEY: adminKey },
    });
    c.stdout.on("data", (data) => {
      process.stdout.write(data);
    });
    c.stderr.on("data", (data) => {
      process.stderr.write(data);
    });
    c.on("exit", (exitCode) => {
      logToStderr(`Command exited with code ${exitCode}`);
      resolve(exitCode);
    });
  });
  return code;
}

(async function main() {
  let code;
  try {
    code = await runWithLocalBackend(process.argv[2], parsedUrl);
  } finally {
    cleanup();
  }
  if (code !== undefined) {
    process.exit(code);
  }
})();
