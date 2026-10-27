import { convexAdapter } from "./adapter.js";
import { version as convexVersion } from "convex";
import semverLt from "semver/functions/lt.js";
import { createClient } from "./create-client.js";
import type { AuthFunctions, Triggers } from "./create-client.js";
import { createApi } from "./create-api.js";
import { createTypedAdapter } from "./create-typed-adapter.js";
import type { CreateAuth, EventFunction, GenericCtx } from "../utils/index.js";
import type {
  AdapterFunctions,
  AdapterWhere,
  BatchResult,
  SortBy,
  TypedAdapter,
} from "./create-typed-adapter.js";

if (semverLt(convexVersion, "1.25.0")) {
  throw new Error("Convex version must be at least 1.25.0");
}

export {
  convexAdapter,
  createClient,
  createApi,
  createTypedAdapter,
  type AdapterFunctions,
  type AdapterWhere,
  type BatchResult,
  type SortBy,
  type CreateAuth,
  type EventFunction,
  type GenericCtx,
  type Triggers,
  type AuthFunctions,
  type TypedAdapter,
};
