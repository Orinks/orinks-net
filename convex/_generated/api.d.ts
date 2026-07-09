/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as boosts from "../boosts.js";
import type * as freightFate from "../freightFate.js";
import type * as freightFateSaves from "../freightFateSaves.js";
import type * as mutators from "../mutators.js";
import type * as notifications from "../notifications.js";
import type * as questionBank from "../questionBank.js";
import type * as trivia from "../trivia.js";
import type * as visits from "../visits.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  boosts: typeof boosts;
  freightFate: typeof freightFate;
  freightFateSaves: typeof freightFateSaves;
  mutators: typeof mutators;
  notifications: typeof notifications;
  questionBank: typeof questionBank;
  trivia: typeof trivia;
  visits: typeof visits;
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
