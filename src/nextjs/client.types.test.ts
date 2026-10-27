import type { FunctionReference } from "convex/server";
import { expectTypeOf, it } from "vitest";
import type { usePreloadedAuthQuery } from "./client.js";

type Todo = { _id: string; text: string };
type TodosQuery = FunctionReference<
  "query",
  "public",
  Record<string, never>,
  Todo[]
>;

it("returns the query result or undefined, like useQuery", () => {
  expectTypeOf<
    ReturnType<typeof usePreloadedAuthQuery<TodosQuery>>
  >().toEqualTypeOf<Todo[] | undefined>();
});
