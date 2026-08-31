import { v } from "convex/values";

export const MEANINGFUL_PLAY_REASONS = [
  "job_accepted",
  "drive_started",
  "delivery_completed",
  "equipment_changed",
  "business_changed",
  "changed_save",
] as const;

export type MeaningfulPlayReason = typeof MEANINGFUL_PLAY_REASONS[number];

export type MeaningfulPlay = {
  operationId: string;
  occurredAt: number;
  reason: MeaningfulPlayReason;
};

export const meaningfulPlayValidator = v.object({
  operationId: v.string(),
  occurredAt: v.number(),
  reason: v.union(...MEANINGFUL_PLAY_REASONS.map((reason) => v.literal(reason))),
});

const MAX_PAST_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

export function validateMeaningfulPlay(value: unknown, now: number):
  | { ok: true; value: MeaningfulPlay | null | undefined }
  | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3
    || typeof record.operationId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/.test(record.operationId)
    || typeof record.occurredAt !== "number"
    || !Number.isInteger(record.occurredAt)
    || record.occurredAt < now - MAX_PAST_MS
    || record.occurredAt > now + MAX_FUTURE_MS
    || typeof record.reason !== "string"
    || !MEANINGFUL_PLAY_REASONS.includes(record.reason as MeaningfulPlayReason)) {
    return { ok: false };
  }
  return { ok: true, value: record as MeaningfulPlay };
}
