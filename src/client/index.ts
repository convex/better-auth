import { convexAdapter } from "./adapter.js";
import { version as convexVersion } from "convex";
import semverLt from "semver/functions/lt.js";
import { createClient } from "./create-client.js";
import type { AuthFunctions, Triggers } from "./create-client.js";
import { createApi } from "./create-api.js";
import type { CreateAuth, EventFunction, GenericCtx } from "../utils/index.js";

if (semverLt(convexVersion, "1.46.0")) {
  throw new Error("Convex version must be at least 1.46.0");
}

export {
  convexAdapter,
  createClient,
  createApi,
  type CreateAuth,
  type EventFunction,
  type GenericCtx,
  type Triggers,
  type AuthFunctions,
};
