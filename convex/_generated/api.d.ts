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
import type * as crons from "../crons.js";
import type * as freightFate from "../freightFate.js";
import type * as freightFateAdmin from "../freightFateAdmin.js";
import type * as freightFateRateLimit from "../freightFateRateLimit.js";
import type * as freightFateSaveActions from "../freightFateSaveActions.js";
import type * as freightFateSaves from "../freightFateSaves.js";
import type * as freightFateSharedProfileSigning from "../freightFateSharedProfileSigning.js";
import type * as freightFateSharedProfileValidation from "../freightFateSharedProfileValidation.js";
import type * as moderation from "../moderation.js";
import type * as mutators from "../mutators.js";
import type * as notifications from "../notifications.js";
import type * as questionBank from "../questionBank.js";
import type * as questionClipValidation from "../questionClipValidation.js";
import type * as questionTypes from "../questionTypes.js";
import type * as trivia from "../trivia.js";
import type * as triviaActiveRun from "../triviaActiveRun.js";
import type * as triviaDailyEpisodes from "../triviaDailyEpisodes.js";
import type * as triviaDeterminism from "../triviaDeterminism.js";
import type * as triviaEpisodePlanner from "../triviaEpisodePlanner.js";
import type * as triviaRunRecovery from "../triviaRunRecovery.js";
import type * as triviaRuntime from "../triviaRuntime.js";
import type * as triviaSelection from "../triviaSelection.js";
import type * as triviaStartHandlers from "../triviaStartHandlers.js";
import type * as triviaStoryBeats from "../triviaStoryBeats.js";
import type * as triviaStoryHandler from "../triviaStoryHandler.js";
import type * as triviaVersions from "../triviaVersions.js";
import type * as visits from "../visits.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  boosts: typeof boosts;
  crons: typeof crons;
  freightFate: typeof freightFate;
  freightFateAdmin: typeof freightFateAdmin;
  freightFateRateLimit: typeof freightFateRateLimit;
  freightFateSaveActions: typeof freightFateSaveActions;
  freightFateSaves: typeof freightFateSaves;
  freightFateSharedProfileSigning: typeof freightFateSharedProfileSigning;
  freightFateSharedProfileValidation: typeof freightFateSharedProfileValidation;
  moderation: typeof moderation;
  mutators: typeof mutators;
  notifications: typeof notifications;
  questionBank: typeof questionBank;
  questionClipValidation: typeof questionClipValidation;
  questionTypes: typeof questionTypes;
  trivia: typeof trivia;
  triviaActiveRun: typeof triviaActiveRun;
  triviaDailyEpisodes: typeof triviaDailyEpisodes;
  triviaDeterminism: typeof triviaDeterminism;
  triviaEpisodePlanner: typeof triviaEpisodePlanner;
  triviaRunRecovery: typeof triviaRunRecovery;
  triviaRuntime: typeof triviaRuntime;
  triviaSelection: typeof triviaSelection;
  triviaStartHandlers: typeof triviaStartHandlers;
  triviaStoryBeats: typeof triviaStoryBeats;
  triviaStoryHandler: typeof triviaStoryHandler;
  triviaVersions: typeof triviaVersions;
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
