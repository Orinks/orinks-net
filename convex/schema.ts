import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  siteCounters: defineTable({
    name: v.string(),
    count: v.number(),
  }).index("by_name", ["name"]),
});
