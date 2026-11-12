import { describe, expect, it } from "vitest";
import {
  bodyOf,
  composeEmail,
  isBlocked,
  MAX_LOG_BYTES,
  parseBlockList,
  parseReport,
  subjectOf,
  takesApp,
} from "./problem-reports";

const good = {
  app: "Freight Fate",
  version: "1.9.6",
  os: "windows x86_64",
  description: "The dock menu is empty.\nIt happens at every warehouse.",
  crashed: false,
  attachments: [{ name: "session.log", text: "12:00 INFO started\n" }],
};

describe("parseReport", () => {
  it("takes a report the game would send", () => {
    const parsed = parseReport(good);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.report.app).toBe("Freight Fate");
    expect(parsed.report.attachments).toHaveLength(1);
    expect(parsed.report.commit).toBeUndefined();
  });

  it("refuses what is not a report", () => {
    expect(parseReport(null)).toMatchObject({ ok: false, status: 400 });
    expect(parseReport([])).toMatchObject({ ok: false, status: 400 });
    expect(parseReport({ ...good, description: "  " })).toMatchObject({ ok: false, error: "description is empty" });
    expect(parseReport({ ...good, version: "1.9.6\nBcc: x@example.com" })).toMatchObject({
      ok: false,
      error: "version has a control character",
    });
    expect(parseReport({ ...good, reply_to: "not an address" })).toMatchObject({
      ok: false,
      error: "reply_to is not an email address",
    });
    expect(parseReport({ ...good, attachments: [{ name: "../secrets", text: "x" }] })).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("answers 413 for a report that is too big", () => {
    expect(parseReport({ ...good, description: "x".repeat(20_001) })).toMatchObject({ ok: false, status: 413 });
    expect(
      parseReport({ ...good, attachments: [{ name: "a.log", text: "x".repeat(MAX_LOG_BYTES + 1) }] }),
    ).toMatchObject({ ok: false, status: 413 });
    expect(
      parseReport({ ...good, attachments: Array.from({ length: 5 }, (_, i) => ({ name: `${i}.log`, text: "x" })) }),
    ).toMatchObject({ ok: false, status: 413 });
  });
});

describe("the email", () => {
  it("has mailbag's subject and body", () => {
    const parsed = parseReport({ ...good, commit: "abc123", reply_to: "driver@example.com", crashed: true });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(subjectOf(parsed.report)).toBe("[Freight Fate 1.9.6] crash: The dock menu is empty.");
    expect(bodyOf(parsed.report)).toBe(
      "What happened:\nThe dock menu is empty.\nIt happens at every warehouse.\n\nApp: Freight Fate 1.9.6 (commit abc123)\nSystem: windows x86_64\nCrashed on its last run: yes\nReply to: driver@example.com\n",
    );
    const email = composeEmail(parsed.report);
    expect(email.reply_to).toBe("driver@example.com");
    expect(email.attachments).toEqual([
      { filename: "session.log", content: Buffer.from("12:00 INFO started\n").toString("base64") },
    ]);
  });
});

describe("who is taken", () => {
  it("knows the games by name, whatever the case", () => {
    expect(takesApp("Freight Fate")).toBe(true);
    expect(takesApp("freight fate")).toBe(true);
    expect(takesApp("Paperback")).toBe(false);
  });

  it("blocks addresses and IPv4 ranges", () => {
    const blocked = parseBlockList("203.0.113.7, 198.51.100.0/24 2001:db8::1");
    expect(blocked).toEqual(["203.0.113.7", "198.51.100.0/24", "2001:db8::1"]);
    expect(isBlocked("203.0.113.7", blocked)).toBe(true);
    expect(isBlocked("198.51.100.200", blocked)).toBe(true);
    expect(isBlocked("198.51.101.1", blocked)).toBe(false);
    expect(isBlocked("2001:db8::1", blocked)).toBe(true);
    expect(isBlocked(null, blocked)).toBe(false);
    expect(isBlocked("203.0.113.7", [])).toBe(false);
  });
});
