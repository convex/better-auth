import type { BetterAuthClientPlugin } from "better-auth/client";
import type { convex } from "./index.js";

export const convexClient = () => {
  return {
    id: "convex",
    $InferServerPlugin: {} as ReturnType<typeof convex>,
  } satisfies BetterAuthClientPlugin;
};
