import { describe, expect, test } from "vitest";
import {
  parseFccRow,
  pickTransmitter,
  placementFor,
  queryUrl,
  rangeFor,
  servicesFor,
  type Transmitter,
} from "./freightFateStationPlacement";

// Shaped like the FCC query's pipe-delimited "list=4" output: a leading
// pipe, then call, frequency, service, channel, ..., status at 9, community
// and state at 10 and 11, ERP at 14, facility id at 18, latitude from 19 and
// longitude from 23 as direction, degrees, minutes, seconds.
function fccLine(fields: Partial<Record<number, string>>) {
  const row = Array.from({ length: 30 }, () => "-");
  const base: Record<number, string> = {
    1: "KWSC-FM   ",
    2: "91.9  MHz ",
    3: "FM  ",
    9: "LIC    ",
    10: "WAYNE                    ",
    11: "NE ",
    14: "13.0   kW ",
    18: "71880     ",
    19: "N ",
    20: "42 ",
    21: "14 ",
    22: "24.00 ",
    23: "W ",
    24: "97 ",
    25: "0 ",
    26: "36.00 ",
  };
  for (const [index, value] of Object.entries({ ...base, ...fields })) row[Number(index)] = value ?? "";
  row[0] = "";
  return row.join("|");
}

const parsed = (fields: Partial<Record<number, string>> = {}) => parseFccRow(fccLine(fields));

describe("reading the FCC query", () => {
  test("reads a licensed transmitter's place, power and band", () => {
    expect(parsed()).toEqual({
      callSign: "KWSC-FM",
      service: "FM",
      frequency: 91.9,
      state: "NE",
      community: "Wayne",
      lat: 42.24,
      lon: -97.01,
      erpKw: 13,
    });
  });

  test("skips permits, deleted licences and impossible places", () => {
    expect(parsed({ 9: "CP" })).toBeNull();
    expect(parsed({ 1: "DKWSC" })).toBeNull();
    expect(parsed({ 20: "0", 21: "0", 22: "0", 24: "0", 25: "0", 26: "0" })).toBeNull();
    expect(parseFccRow("not a row")).toBeNull();
  });
});

describe("choosing the transmitter", () => {
  const site = (overrides: Partial<Transmitter>): Transmitter => ({ ...parsed()!, ...overrides });

  test("the call sign must match, and the full-power station beats its translators", () => {
    const rows = [
      site({ callSign: "K230AB", service: "FX" }),
      site({ callSign: "KWSC", service: "FX", lat: 41 }),
      site({ callSign: "KWSC-FM", service: "FM", lat: 42.24 }),
    ];
    expect(pickTransmitter(rows, { callSign: "KWSC" })?.lat).toBe(42.24);
    expect(pickTransmitter(rows, { callSign: "WXYZ" })).toBeNull();
  });

  test("the stated frequency and state break ties", () => {
    const rows = [
      site({ frequency: 88.1, state: "SD", lat: 1 + 40 }),
      site({ frequency: 91.9, state: "NE", lat: 2 + 40 }),
    ];
    expect(pickTransmitter(rows, { callSign: "KWSC-FM", frequency: "91.9 FM" })?.lat).toBe(42);
    expect(pickTransmitter(rows, { callSign: "KWSC-FM", state: "NE" })?.lat).toBe(42);
  });

  test("the range follows licensed power, and AM gets its own", () => {
    expect(rangeFor(0.05, "FM")).toBe(8);
    expect(rangeFor(13, "FM")).toBe(32);
    expect(rangeFor(100, "FM")).toBe(55);
    expect(rangeFor(null, "FX")).toBe(10);
    expect(rangeFor(50, "AM")).toBe(25);
    expect(placementFor(parsed()!)).toEqual({
      lat: 42.24, lon: -97.01, rangeMiles: 32, frequencyMhz: 91.9, community: "Wayne",
    });
    expect(placementFor({ ...parsed()!, service: "AM", frequency: 1090 })).not.toHaveProperty("frequencyMhz");
  });

  test("asks the band the player named, or both", () => {
    expect(servicesFor("1090 AM")).toEqual(["AM"]);
    expect(servicesFor("91.9 FM")).toEqual(["FM"]);
    expect(servicesFor(undefined)).toEqual(["FM", "AM"]);
    expect(queryUrl("AM", "KAAY")).toContain("amq?call=KAAY&");
  });
});
