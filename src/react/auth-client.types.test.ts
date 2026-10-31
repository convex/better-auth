import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { expectTypeOf, it } from "vitest";
import { convexClient, crossDomainClient } from "../client/plugins/index.js";
import type { AuthClient, AuthClientWithCrossDomain } from "./index.js";

const storage = {
  getItem: () => null,
  setItem: () => undefined,
};

// Regression coverage for Better Auth 1.7, where deriving AuthClient from
// createAuthClient over a plugin union made useSession().data `never` and no
// real client assignable.
it("accepts a client with the convex plugin and other plugins", () => {
  const authClient = createAuthClient({
    baseURL: "http://localhost:3000",
    plugins: [magicLinkClient(), convexClient()],
  });
  expectTypeOf(authClient).toMatchTypeOf<AuthClient>();
  expectTypeOf<
    ReturnType<typeof authClient.useSession>["data"]
  >().not.toBeNever();
});

it("accepts a client with the cross-domain plugin", () => {
  const authClient = createAuthClient({
    baseURL: "http://localhost:3000",
    plugins: [convexClient(), crossDomainClient({ storage })],
  });
  expectTypeOf(authClient).toMatchTypeOf<AuthClient>();
  expectTypeOf(authClient).toMatchTypeOf<AuthClientWithCrossDomain>();
});

it("rejects a client without the convex plugin", () => {
  const authClient = createAuthClient({
    baseURL: "http://localhost:3000",
    plugins: [magicLinkClient()],
  });
  expectTypeOf(authClient).not.toMatchTypeOf<AuthClient>();
});
