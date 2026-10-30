import { createApi } from "../client/index.js";
import { options } from "../auth-options.js";
import schema from "./schema.js";

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
} = createApi(schema, () => options);
