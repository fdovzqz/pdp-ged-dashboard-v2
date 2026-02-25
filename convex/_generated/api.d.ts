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
import type * as aggregatesCloudwatchETL from "../aggregatesCloudwatchETL.js";
import type * as aggregatesCloudwatchMutations from "../aggregatesCloudwatchMutations.js";
import type * as aggregatesCloudwatchQueries from "../aggregatesCloudwatchQueries.js";
import type * as aggregatesDatamappingQueries from "../aggregatesDatamappingQueries.js";
import type * as annualQueries from "../annualQueries.js";
import type * as annualQueriesDatamapping from "../annualQueriesDatamapping.js";
import type * as cloudwatchActions from "../cloudwatchActions.js";
import type * as cloudwatchMutations from "../cloudwatchMutations.js";
import type * as cloudwatchQueries from "../cloudwatchQueries.js";
import type * as datamappingActions from "../datamappingActions.js";
import type * as datamappingETL from "../datamappingETL.js";
import type * as datamappingMutations from "../datamappingMutations.js";
import type * as datamappingQueries from "../datamappingQueries.js";
import type * as internalDataCleanup from "../internalDataCleanup.js";
import type * as lib_dynamodb from "../lib/dynamodb.js";
import type * as lib_mexicoDate from "../lib/mexicoDate.js";
import type * as lib_parsers from "../lib/parsers.js";
import type * as lib_pipelineStages from "../lib/pipelineStages.js";
import type * as lib_ruleSetSchema from "../lib/ruleSetSchema.js";
import type * as lib_unitHandlers from "../lib/unitHandlers.js";
import type * as lib_workflowConfigSchema from "../lib/workflowConfigSchema.js";
import type * as movementCodes from "../movementCodes.js";
import type * as pipelineActions from "../pipelineActions.js";
import type * as pipelineMutations from "../pipelineMutations.js";
import type * as pipelineQueries from "../pipelineQueries.js";
import type * as reconciliationActions from "../reconciliationActions.js";
import type * as reconciliationMutations from "../reconciliationMutations.js";
import type * as reconciliationQueries from "../reconciliationQueries.js";
import type * as ruleSets from "../ruleSets.js";
import type * as sources from "../sources.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  aggregatesCloudwatchETL: typeof aggregatesCloudwatchETL;
  aggregatesCloudwatchMutations: typeof aggregatesCloudwatchMutations;
  aggregatesCloudwatchQueries: typeof aggregatesCloudwatchQueries;
  aggregatesDatamappingQueries: typeof aggregatesDatamappingQueries;
  annualQueries: typeof annualQueries;
  annualQueriesDatamapping: typeof annualQueriesDatamapping;
  cloudwatchActions: typeof cloudwatchActions;
  cloudwatchMutations: typeof cloudwatchMutations;
  cloudwatchQueries: typeof cloudwatchQueries;
  datamappingActions: typeof datamappingActions;
  datamappingETL: typeof datamappingETL;
  datamappingMutations: typeof datamappingMutations;
  datamappingQueries: typeof datamappingQueries;
  internalDataCleanup: typeof internalDataCleanup;
  "lib/dynamodb": typeof lib_dynamodb;
  "lib/mexicoDate": typeof lib_mexicoDate;
  "lib/parsers": typeof lib_parsers;
  "lib/pipelineStages": typeof lib_pipelineStages;
  "lib/ruleSetSchema": typeof lib_ruleSetSchema;
  "lib/unitHandlers": typeof lib_unitHandlers;
  "lib/workflowConfigSchema": typeof lib_workflowConfigSchema;
  movementCodes: typeof movementCodes;
  pipelineActions: typeof pipelineActions;
  pipelineMutations: typeof pipelineMutations;
  pipelineQueries: typeof pipelineQueries;
  reconciliationActions: typeof reconciliationActions;
  reconciliationMutations: typeof reconciliationMutations;
  reconciliationQueries: typeof reconciliationQueries;
  ruleSets: typeof ruleSets;
  sources: typeof sources;
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
