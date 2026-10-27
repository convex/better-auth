/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapter from "../adapter.js";
import type * as session from "../session.js";
import type * as testProfiles_adapterAdditionalFields from "../testProfiles/adapterAdditionalFields.js";
import type * as testProfiles_adapterOrganizationJoins from "../testProfiles/adapterOrganizationJoins.js";
import type * as testProfiles_adapterPluginTable from "../testProfiles/adapterPluginTable.js";
import type * as testProfiles_adapterRenameField from "../testProfiles/adapterRenameField.js";
import type * as testProfiles_adapterRenameUserCustom from "../testProfiles/adapterRenameUserCustom.js";
import type * as testProfiles_adapterRenameUserTable from "../testProfiles/adapterRenameUserTable.js";
import type * as testTriggerHandlers from "../testTriggerHandlers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  adapter: typeof adapter;
  session: typeof session;
  "testProfiles/adapterAdditionalFields": typeof testProfiles_adapterAdditionalFields;
  "testProfiles/adapterOrganizationJoins": typeof testProfiles_adapterOrganizationJoins;
  "testProfiles/adapterPluginTable": typeof testProfiles_adapterPluginTable;
  "testProfiles/adapterRenameField": typeof testProfiles_adapterRenameField;
  "testProfiles/adapterRenameUserCustom": typeof testProfiles_adapterRenameUserCustom;
  "testProfiles/adapterRenameUserTable": typeof testProfiles_adapterRenameUserTable;
  testTriggerHandlers: typeof testTriggerHandlers;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
