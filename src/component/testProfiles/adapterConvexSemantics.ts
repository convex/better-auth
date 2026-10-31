import { createApi } from "../../client/index.js";
import { convexSemanticsProfileOptions } from "./auth-options.profile-convex-semantics.js";
import schema from "./schema.profile-convex-semantics.js";

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
  consumeOne,
  incrementOne,
} = createApi(schema, () => convexSemanticsProfileOptions);
