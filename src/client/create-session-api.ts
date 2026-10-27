import { queryGeneric } from "convex/server";
import type {
  GenericDatabaseReader,
  GenericDataModel,
  GenericSchema,
  SchemaDefinition,
} from "convex/server";
import { v } from "convex/values";
import { doc } from "convex-helpers/validators";

const getDoc = async (
  db: GenericDatabaseReader<GenericDataModel>,
  table: "session" | "user",
  id: string
) => {
  const normalizedId = db.normalizeId(table, id);
  return normalizedId ? await db.get(table, normalizedId) : null;
};

/**
 * Creates lightweight queries for reading the current session and user.
 *
 * `createClient` uses these for `getAuthUser`, `safeGetAuthUser`,
 * `getHeaders`, and `getAnyUserById` instead of the generic adapter. The
 * adapter module loads Better Auth and every configured plugin each time one
 * of its functions runs; this module imports neither, and resolves the
 * session and its user in one call.
 *
 * Import it from `@convex-dev/better-auth/session` so the component module
 * does not pull in the rest of the package.
 *
 * @param schema - The Better Auth component schema
 */
export const createSessionApi = (
  schema: SchemaDefinition<GenericSchema, boolean>
) => {
  const userDoc = v.union(v.null(), doc(schema, "user"));
  const sessionDoc = v.union(v.null(), doc(schema, "session"));
  return {
    getSessionUser: queryGeneric({
      args: { sessionId: v.string(), userId: v.string(), now: v.number() },
      returns: userDoc,
      handler: async (ctx, args) => {
        const session = await getDoc(ctx.db, "session", args.sessionId);
        if (
          !session ||
          typeof session.expiresAt !== "number" ||
          session.expiresAt <= args.now
        ) {
          return null;
        }
        return await getDoc(ctx.db, "user", args.userId);
      },
    }),
    getSession: queryGeneric({
      args: { sessionId: v.string() },
      returns: sessionDoc,
      handler: async (ctx, args) => {
        return await getDoc(ctx.db, "session", args.sessionId);
      },
    }),
    getUser: queryGeneric({
      args: { userId: v.string() },
      returns: userDoc,
      handler: async (ctx, args) => {
        return await getDoc(ctx.db, "user", args.userId);
      },
    }),
  };
};
