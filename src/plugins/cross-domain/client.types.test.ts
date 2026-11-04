import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { expectTypeOf, it } from "vitest";
import { convexClient } from "../convex/client.js";
import { crossDomainClient } from "./client.js";

const storage = {
  getItem: () => null,
  setItem: () => undefined,
};

it("composes with Better Auth client plugins and infers cross-domain actions", () => {
  const authClient = createAuthClient({
    baseURL: "http://localhost:3000",
    plugins: [convexClient(), crossDomainClient({ storage }), adminClient()],
  });

  expectTypeOf(authClient.getCookie).toEqualTypeOf<() => Promise<string>>();
});
