import { createTableApi } from "../client/create-api.js";
import { adapterTables } from "../adapter-tables.js";
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
} = createTableApi(schema, adapterTables);
