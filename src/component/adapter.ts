import { createApi } from "../client/index.js";
import { options } from "../auth-options.js";
import schema from "./schema.js";

export const {
  create,
  findOne,
  findMany,
  updateOne,
  incrementOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, () => options);
