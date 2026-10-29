import { createApi } from "../../client/index.js";
import { constraintsProfileOptions } from "./auth-options.constraints.js";
import schema from "./schema.constraints.js";

export const {
  create,
  findOne,
  findMany,
  updateOne,
  incrementOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, () => constraintsProfileOptions);
