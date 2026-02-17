/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions from "../actions.js";
import type * as annualQueries from "../annualQueries.js";
import type * as annualQueriesDatamapping from "../annualQueriesDatamapping.js";
import type * as datamappingETL from "../datamappingETL.js";
import type * as datamappingMutations from "../datamappingMutations.js";
import type * as januaryETL from "../januaryETL.js";
import type * as januaryMutations from "../januaryMutations.js";
import type * as januaryQueries from "../januaryQueries.js";
import type * as januaryQueriesDatamapping from "../januaryQueriesDatamapping.js";
import type * as lib_dynamodb from "../lib/dynamodb.js";
import type * as lib_mexicoDate from "../lib/mexicoDate.js";
import type * as lib_parsers from "../lib/parsers.js";
import type * as movementCodes from "../movementCodes.js";
import type * as mutations from "../mutations.js";
import type * as pipelineJobs from "../pipelineJobs.js";
import type * as queries from "../queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  annualQueries: typeof annualQueries;
  annualQueriesDatamapping: typeof annualQueriesDatamapping;
  datamappingETL: typeof datamappingETL;
  datamappingMutations: typeof datamappingMutations;
  januaryETL: typeof januaryETL;
  januaryMutations: typeof januaryMutations;
  januaryQueries: typeof januaryQueries;
  januaryQueriesDatamapping: typeof januaryQueriesDatamapping;
  "lib/dynamodb": typeof lib_dynamodb;
  "lib/mexicoDate": typeof lib_mexicoDate;
  "lib/parsers": typeof lib_parsers;
  movementCodes: typeof movementCodes;
  mutations: typeof mutations;
  pipelineJobs: typeof pipelineJobs;
  queries: typeof queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
