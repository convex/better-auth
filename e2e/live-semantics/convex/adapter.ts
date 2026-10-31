import { createApi } from "../../../src/client/index.js";
import { convexSemanticsProfileOptions } from "../../../src/component/testProfiles/auth-options.profile-convex-semantics.js";
import schema from "../../../src/component/testProfiles/schema.profile-convex-semantics.js";

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
