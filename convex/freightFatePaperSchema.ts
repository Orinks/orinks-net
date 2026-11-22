// Tables for the driver newspaper (convex/freightFatePaper.ts), spread into
// schema.ts. Nothing public reads these except getEdition and listEditions,
// which read one edition row and the driver rows it names.
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const paperFactValue = v.union(v.number(), v.string(), v.array(v.string()));

export const paperStory = v.object({
  id: v.string(),
  section: v.string(),
  kind: v.string(),
  driverIds: v.array(v.string()),
  // Numbers and catalog keys only; never a display name, never text the game
  // typed. The one exception is accepted radio station names, which the owner
  // approved on the review page.
  facts: v.record(v.string(), paperFactValue),
  variant: v.number(),
  rank: v.number(),
  pulled: v.optional(v.boolean()),
});

export const paperSafety = v.object({
  citations: v.number(),
  seriousViolations: v.number(),
  majorOffenses: v.number(),
  outOfServiceOrders: v.optional(v.number()),
  crashes: v.optional(v.number()),
  cargoClaims: v.optional(v.number()),
  preventableEquipmentDamage: v.optional(v.number()),
  carrierTerminations: v.number(),
  repossessions: v.number(),
});

// The snapshot numbers the paper compares week to week. Fatigue, cash and
// anything the public snapshot withholds are not here.
export const paperLedgerFields = {
  driverId: v.string(),
  // The career these numbers belong to (the snapshot's save slot). Compared,
  // never printed.
  saveName: v.string(),
  snapshotUpdatedAt: v.number(),
  sourceRevision: v.optional(v.number()),
  deliveries: v.number(),
  milesDriven: v.number(),
  onTimeDeliveries: v.number(),
  level: v.number(),
  careerTitle: v.string(),
  carrierName: v.optional(v.string()),
  businessStatus: v.optional(v.string()),
  truckName: v.optional(v.string()),
  truckIsCarrierAssigned: v.optional(v.boolean()),
  endorsements: v.array(v.string()),
  statesVisited: v.optional(v.number()),
  citiesVisited: v.optional(v.number()),
  lifetimeEarnings: v.optional(v.number()),
  safety: v.optional(paperSafety),
  // The issue that last put this driver on the front page; front-page ties
  // go to the oldest.
  lastFrontPageIssue: v.optional(v.number()),
  updatedAt: v.number(),
};

export const paperLoadFacts = v.object({
  miles: v.optional(v.number()),
  pounds: v.optional(v.number()),
  cargoKey: v.optional(v.string()),
  originKey: v.optional(v.string()),
  destinationKey: v.optional(v.string()),
});

const countRow = v.object({ key: v.string(), count: v.number() });

export const paperTables = {
  // One row, key "paper": where the daily job has read to, which weeks are
  // closed, the build in progress, and failures waiting for the digest.
  freightFatePaperState: defineTable({
    key: v.string(),
    seeded: v.boolean(),
    seedCursor: v.optional(v.union(v.string(), v.null())),
    // The _creationTime of the last driver event the daily job has read.
    cursor: v.number(),
    lastIssue: v.number(),
    lastClosedWeek: v.optional(v.string()),
    // The start of the period the next edition covers: the end of the last
    // published one. A thin week leaves it where it is, so the next edition
    // covers both weeks.
    periodStart: v.optional(v.number()),
    bestWeekMiles: v.optional(v.object({ miles: v.number(), driverId: v.string(), issue: v.number() })),
    build: v.optional(v.object({
      weekKey: v.string(),
      periodStart: v.number(),
      periodEnd: v.number(),
      cursor: v.union(v.string(), v.null()),
      done: v.boolean(),
      nameable: v.number(),
      startedAt: v.number(),
    })),
    failures: v.array(v.object({
      at: v.number(),
      weekKey: v.string(),
      message: v.string(),
      reported: v.boolean(),
    })),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  freightFatePaperLedger: defineTable(paperLedgerFields).index("by_driver", ["driverId"]),

  // The open week's running totals for one driver, from delivery events.
  freightFatePaperDriverTallies: defineTable({
    weekKey: v.string(),
    driverId: v.string(),
    deliveries: v.number(),
    firstDelivery: v.optional(v.boolean()),
    firstLoad: v.optional(paperLoadFacts),
    longest: v.optional(paperLoadFacts),
    heaviest: v.optional(paperLoadFacts),
    achievements: v.array(v.string()),
  })
    .index("by_week", ["weekKey"])
    .index("by_driver_week", ["driverId", "weekKey"]),

  // The open week's totals across drivers.
  freightFatePaperWeekTallies: defineTable({
    weekKey: v.string(),
    loads: v.number(),
    miles: v.number(),
    pounds: v.number(),
    drivers: v.number(),
    lanes: v.array(v.object({ originKey: v.string(), destinationKey: v.string(), count: v.number() })),
    cargo: v.array(v.object({ key: v.string(), count: v.number(), pounds: v.number() })),
    // Version 2 deliveries only (task N4). The Road report reads these.
    conditions: v.object({
      loads: v.number(),
      chainLaw: v.number(),
      workZones: v.number(),
      scales: v.number(),
      inspections: v.number(),
      weather: v.array(countRow),
    }),
    updatedAt: v.number(),
  }).index("by_week", ["weekKey"]),

  freightFatePaperEditions: defineTable({
    issue: v.number(),
    // The Monday the closed week began, YYYY-MM-DD Eastern.
    weekKey: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    state: v.union(v.literal("building"), v.literal("preview"), v.literal("published"), v.literal("pulled")),
    builtAt: v.number(),
    publishedAt: v.optional(v.number()),
    stories: v.array(paperStory),
    records: v.array(v.object({ record: v.string(), driverId: v.string(), value: v.number() })),
    standings: v.array(v.object({
      carrierKey: v.string(),
      drivers: v.number(),
      loads: v.number(),
      miles: v.number(),
      onTimeRate: v.optional(v.number()),
    })),
    backPage: v.array(v.string()),
    // The open week so far, refreshed by the daily job. Counts only.
    sinceMonday: v.optional(v.object({
      weekKey: v.string(),
      asOf: v.number(),
      drivers: v.number(),
      loads: v.number(),
      miles: v.number(),
      tons: v.number(),
    })),
  })
    .index("by_issue", ["issue"])
    .index("by_state_issue", ["state", "issue"]),

  // The list of editions, small enough that listEditions never opens one.
  freightFatePaperIssues: defineTable({
    issue: v.number(),
    weekKey: v.string(),
    state: v.union(v.literal("building"), v.literal("preview"), v.literal("published"), v.literal("pulled")),
    publishedAt: v.optional(v.number()),
  }).index("by_issue", ["issue"]),

  // One row per city that has had a delivery. Seeded rows (the cities
  // drivers had already reached when the paper started) have no driver and
  // are never a story.
  freightFatePaperFirsts: defineTable({
    cityKey: v.string(),
    driverId: v.optional(v.string()),
    firstAt: v.number(),
    seeded: v.boolean(),
    reported: v.boolean(),
    issue: v.optional(v.number()),
    load: v.optional(paperLoadFacts),
  })
    .index("by_city", ["cityKey"])
    .index("by_driver", ["driverId"])
    .index("by_reported", ["reported", "firstAt"]),

  // The weekly build's working rows, one per nameable driver with something
  // to say, deleted when the build finishes.
  freightFatePaperDrafts: defineTable({
    weekKey: v.string(),
    driverId: v.string(),
    stories: v.array(v.object({
      kind: v.string(),
      facts: v.record(v.string(), paperFactValue),
    })),
    // Connected an account during the period.
    newHire: v.optional(v.boolean()),
    week: v.object({
      // False after a career switch or a restore: no records this week.
      ranked: v.boolean(),
      // Deliveries the daily job counted from events.
      tallyLoads: v.number(),
      miles: v.number(),
      deliveries: v.number(),
      onTime: v.number(),
      newCities: v.number(),
      carrierKey: v.optional(v.string()),
      longest: v.optional(paperLoadFacts),
      heaviest: v.optional(paperLoadFacts),
      safety: v.object({
        citations: v.number(),
        outOfServiceOrders: v.number(),
        crashes: v.number(),
        cargoClaims: v.number(),
      }),
    }),
    achievements: v.array(v.string()),
    lastFrontPageIssue: v.optional(v.number()),
    ledgerNext: v.optional(v.object(paperLedgerFields)),
  }).index("by_week_driver", ["weekKey", "driverId"]),
};
