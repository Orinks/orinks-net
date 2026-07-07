import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  buildNotificationSubscriptions: defineTable({
    endpoint: v.string(),
    expirationTime: v.optional(v.number()),
    keys: v.object({
      auth: v.string(),
      p256dh: v.string(),
    }),
    product: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_endpoint_product", ["endpoint", "product"]),
  siteCounters: defineTable({
    name: v.string(),
    count: v.number(),
    environmentKey: v.optional(v.string()),
    period: v.optional(v.union(v.literal("lifetime"), v.literal("daily"))),
    dateKey: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index("by_name", ["name"]),
  freightFateDrivers: defineTable({
    driverId: v.string(),
    displayName: v.string(),
    // public: listed on the live drivers board; unlisted: profile reachable
    // by URL only; private: nothing shown anywhere.
    visibility: v.union(v.literal("public"), v.literal("private"), v.literal("unlisted")),
    driverTokenHash: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_driver_id", ["driverId"]),
  freightFateSetupSessions: defineTable({
    setupTokenHash: v.string(),
    driverId: v.string(),
    driverTokenHash: v.string(),
    displayName: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
    confirmedAt: v.optional(v.number()),
  }).index("by_setup_token", ["setupTokenHash"]),
  // Live "who's on duty" board: one row per driver holding only the latest
  // heartbeat. Rows older than the board TTL are treated as offline and
  // pruned on the next write; no history is kept by design.
  freightFatePresence: defineTable({
    driverId: v.string(),
    activity: v.string(),
    detail: v.string(),
    updatedAt: v.number(),
  })
    .index("by_driver_id", ["driverId"])
    .index("by_updated", ["updatedAt"]),
  freightFateDriverEvents: defineTable({
    driverId: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    summary: v.string(),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_driver", ["driverId"])
    .index("by_driver_event", ["driverId", "eventId"]),
});
