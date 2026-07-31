import { describe, expect, it } from "vitest";
import {
  CONTACT_LIMITS,
  formatContactEmail,
  validateContactSubmission,
} from "./contact";

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  subject: "About AccessiWeather",
  message: "The forecast view reads beautifully in NVDA. Thank you.",
};

describe("validateContactSubmission", () => {
  it("accepts a well-formed submission and returns trimmed values", () => {
    const result = validateContactSubmission({
      name: "  Ada Lovelace  ",
      email: "  ADA@Example.com ",
      subject: " About AccessiWeather ",
      message: "  Hello there.  ",
    });

    expect(result.errors).toEqual({});
    expect(result.values).toEqual({
      name: "Ada Lovelace",
      // Addresses are lowercased so Reply-To is stable regardless of typing.
      email: "ada@example.com",
      subject: "About AccessiWeather",
      message: "Hello there.",
    });
  });

  it("reports every empty field at once rather than stopping at the first", () => {
    const result = validateContactSubmission({
      name: "",
      email: "",
      subject: "",
      message: "",
    });

    expect(Object.keys(result.errors).sort()).toEqual([
      "email",
      "message",
      "name",
      "subject",
    ]);
  });

  it("treats whitespace-only fields as empty", () => {
    const result = validateContactSubmission({ ...valid, message: "   \n\t  " });

    expect(result.errors.message).toBeTruthy();
  });

  it("rejects addresses that are not plausibly email-shaped", () => {
    for (const email of ["ada", "ada@", "@example.com", "ada@example", "a b@example.com"]) {
      const result = validateContactSubmission({ ...valid, email });
      expect(result.errors.email, `expected "${email}" to be rejected`).toBeTruthy();
    }
  });

  it("accepts ordinary real-world addresses", () => {
    for (const email of [
      "ada+news@example.com",
      "ada.lovelace@sub.example.co.uk",
      "a_b-c@example.io",
    ]) {
      const result = validateContactSubmission({ ...valid, email });
      expect(result.errors.email, `expected "${email}" to be accepted`).toBeUndefined();
    }
  });

  it("rejects fields longer than their limit", () => {
    expect(
      validateContactSubmission({ ...valid, name: "a".repeat(CONTACT_LIMITS.name + 1) }).errors.name,
    ).toBeTruthy();
    expect(
      validateContactSubmission({ ...valid, subject: "a".repeat(CONTACT_LIMITS.subject + 1) })
        .errors.subject,
    ).toBeTruthy();
    expect(
      validateContactSubmission({ ...valid, message: "a".repeat(CONTACT_LIMITS.message + 1) })
        .errors.message,
    ).toBeTruthy();
  });

  it("accepts fields exactly at their limit", () => {
    expect(
      validateContactSubmission({ ...valid, name: "a".repeat(CONTACT_LIMITS.name) }).errors.name,
    ).toBeUndefined();
    expect(
      validateContactSubmission({ ...valid, message: "a".repeat(CONTACT_LIMITS.message) })
        .errors.message,
    ).toBeUndefined();
  });

  // Name, email and subject are interpolated into real mail headers, where a
  // bare CR or LF would let a sender inject their own headers (Bcc, etc).
  it("rejects newlines in the fields that become mail headers", () => {
    for (const field of ["name", "email", "subject"] as const) {
      for (const injection of ["a\nBcc: victim@example.com", "a\rBcc: victim@example.com"]) {
        const result = validateContactSubmission({ ...valid, [field]: injection });
        expect(result.errors[field], `expected ${field} to reject ${JSON.stringify(injection)}`)
          .toBeTruthy();
      }
    }
  });

  it("allows newlines in the message body, which is not a header", () => {
    const result = validateContactSubmission({
      ...valid,
      message: "First paragraph.\n\nSecond paragraph.",
    });

    expect(result.errors.message).toBeUndefined();
    expect(result.values.message).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("rejects non-string input without throwing", () => {
    const result = validateContactSubmission({
      name: 42,
      email: null,
      subject: undefined,
      message: { text: "hi" },
    });

    expect(Object.keys(result.errors).sort()).toEqual([
      "email",
      "message",
      "name",
      "subject",
    ]);
  });

  it("rejects a non-object body without throwing", () => {
    expect(validateContactSubmission(null).errors.name).toBeTruthy();
    expect(validateContactSubmission("nope").errors.message).toBeTruthy();
  });
});

describe("formatContactEmail", () => {
  const built = formatContactEmail(valid);

  it("puts the sender's subject in the subject line behind a stable prefix", () => {
    expect(built.subject).toBe("[orinks.net] About AccessiWeather");
  });

  it("carries the sender's name and address in the body", () => {
    expect(built.text).toContain("Ada Lovelace");
    expect(built.text).toContain("ada@example.com");
    expect(built.text).toContain("The forecast view reads beautifully in NVDA.");
  });

  it("escapes HTML so a message body cannot inject markup into the email", () => {
    const hostile = formatContactEmail({
      ...valid,
      name: "<script>alert(1)</script>",
      message: "<img src=x onerror=alert(1)>",
    });

    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).not.toContain("<img");
    expect(hostile.html).toContain("&lt;script&gt;");
  });

  it("keeps message line breaks visible in the HTML part", () => {
    const multiline = formatContactEmail({ ...valid, message: "One\nTwo" });

    expect(multiline.html).toContain("<br />");
  });
});
