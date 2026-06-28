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
    visibility: v.union(v.literal("private"), v.literal("unlisted")),
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
