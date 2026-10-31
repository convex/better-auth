import { expectTypeOf, it } from "vitest";
import type { AuthClient } from "./index.js";

it("preserves the core Better Auth client API", () => {
  expectTypeOf<AuthClient["signIn"]>().not.toBeNever();
  expectTypeOf<AuthClient["signOut"]>().toBeFunction();
  expectTypeOf<AuthClient["getSession"]>().toBeFunction();
  expectTypeOf<AuthClient["convex"]["token"]>().toBeFunction();
});
