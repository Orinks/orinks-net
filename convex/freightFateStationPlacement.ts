// Where an accepted AM or FM station's transmitter stands, from the FCC's own
// licence records, so the game can play it near home instead of everywhere.
//
// The player gives a call sign, a state and maybe a frequency. Once the owner
// accepts the station, placeStation asks the FCC's FM or AM query for that
// call sign and keeps the licensed transmitter that matches: its coordinates
// are read from the licence, and the hearing range is derived from the
// licensed power the same way the game's imported tier does it
// (tools/import_radio_catalog.py range_for, which this ports). A call sign the
// FCC does not list stays on the web band, and the nightly re-check asks again
// each week in case the licence appears or the query was down.
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { callSignBase } from "./freightFateStationRules";

const FM_QUERY = "https://transition.fcc.gov/fcc-bin/fmq";
const AM_QUERY = "https://transition.fcc.gov/fcc-bin/amq";
// No URL in it: the FCC's front end answers 403 to a user agent carrying one.
const USER_AGENT = "FreightFate/1.9 (station placement)";
const FCC_TIMEOUT_MS = 30_000;

/** How long a station the FCC did not list waits before it is asked about again. */
export const PLACEMENT_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export type Service = "FM" | "AM";

export type Transmitter = {
  callSign: string;
  service: string;
  frequency: number | null;
  state: string;
  community: string;
  lat: number;
  lon: number;
  erpKw: number | null;
};

export type Placement = {
  lat: number;
  lon: number;
  rangeMiles: number;
  frequencyMhz?: number;
  community: string;
};

// Column positions in the query's pipe-delimited "list=4" output, shared by
// both services (tools/fetch_fcc_transmitters.py pins them with a sample row).
const CALL = 1;
const FREQUENCY = 2;
const SERVICE = 3;
const STATUS = 9;
const COMMUNITY = 10;
const COMMUNITY_STATE = 11;
const ERP_KW = 14;
const LAT_DIR = 19;
const LON_DIR = 23;

const US_CALL_SIGN = /^[KW][A-Z0-9]{2,5}(?:-[A-Z0-9]+)?$/;
const TRANSLATOR_SERVICES = new Set(["FX", "FB", "FS"]);

function dms(parts: string[], at: number) {
  const [direction, degrees, minutes, seconds] = parts.slice(at, at + 4);
  const value = Math.abs(Number(degrees)) + Number(minutes) / 60 + Number(seconds) / 3600;
  if (!Number.isFinite(value)) return null;
  const signed = /^[SW]$/i.test(direction ?? "") ? -value : value;
  return Math.round(signed * 1e5) / 1e5;
}

function leadingNumber(raw: string | undefined) {
  const token = (raw ?? "").trim().split(/\s+/)[0] ?? "";
  if (!token) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/** One licensed US transmitter out of a query line, or null for anything else. */
export function parseFccRow(line: string): Transmitter | null {
  const parts = line.split("|").map((part) => part.trim());
  if (parts.length <= LON_DIR + 3) return null;
  const callSign = (parts[CALL] ?? "").toUpperCase();
  // Construction permits describe transmitters that do not exist yet, and a
  // deleted licence keeps its old call sign with a "D" in front.
  if (parts[STATUS] !== "LIC" || !US_CALL_SIGN.test(callSign)) return null;
  const lat = dms(parts, LAT_DIR);
  const lon = dms(parts, LON_DIR);
  if (lat === null || lon === null) return null;
  // The study rows the FCC carries use impossible coordinates.
  if (!(lat > 17 && lat < 72) || !(lon > -180 && lon < -64)) return null;
  return {
    callSign,
    service: (parts[SERVICE] ?? "").toUpperCase(),
    frequency: leadingNumber(parts[FREQUENCY]),
    state: (parts[COMMUNITY_STATE] ?? "").toUpperCase(),
    community: titleCase(parts[COMMUNITY] ?? ""),
    lat,
    lon,
    erpKw: leadingNumber(parts[ERP_KW]),
  };
}

function titleCase(text: string) {
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Coverage radius by licensed power: what the FCC's class definitions work
// out to for the protected contour. A band, not a terrain model.
const RANGE_BY_ERP_MI: Array<[number, number]> = [
  [0.1, 8],
  [1, 15],
  [6, 22],
  [25, 32],
  [50, 42],
];
const MAX_FM_RANGE_MI = 55;
const AM_RANGE_MI = 25;

/** How far out a licensed transmitter should still be heard, in miles. */
export function rangeFor(erpKw: number | null, service: string) {
  if (service === "AM") return AM_RANGE_MI;
  if (erpKw === null) return TRANSLATOR_SERVICES.has(service) ? 10 : 22;
  for (const [ceiling, miles] of RANGE_BY_ERP_MI) {
    if (erpKw < ceiling) return miles;
  }
  return MAX_FM_RANGE_MI;
}

/** Which bands to ask, from what the player said the frequency was. */
export function servicesFor(frequency: string | undefined): Service[] {
  if (/\bAM$/i.test(frequency ?? "")) return ["AM"];
  if (/\bFM$/i.test(frequency ?? "")) return ["FM"];
  return ["FM", "AM"];
}

export function queryUrl(service: Service, callSign: string) {
  const call = encodeURIComponent(callSign);
  return service === "FM"
    ? `${FM_QUERY}?call=${call}&state=&city=&arn=&serv=&vac=&freq=0.0&fre2=107.9&facid=&class=&list=4&dist=&dlat2=&mlat2=&slat2=&dlon2=&mlon2=&slon2=&size=9`
    : `${AM_QUERY}?call=${call}&state=&city=&arn=&serv=&freq=0&fre2=1700&facid=&class=&list=4&dist=&dlat2=&mlat2=&slat2=&dlon2=&mlon2=&slon2=&size=9`;
}

/**
 * The transmitter the suggestion means, or null. The call sign must match;
 * after that a full-power station beats its translators, then the stated
 * frequency and state break ties. A call sign is one licence, so anything
 * left is the same station's other records (an AM's day and night sites),
 * and the first is kept.
 */
export function pickTransmitter(
  rows: Transmitter[],
  wanted: { callSign: string; state?: string; frequency?: string },
): Transmitter | null {
  const base = callSignBase(wanted.callSign);
  const said = leadingNumber(wanted.frequency);
  const candidates = rows.filter((row) => base && callSignBase(row.callSign) === base);
  if (!candidates.length) return null;
  const score = (row: Transmitter) =>
    (TRANSLATOR_SERVICES.has(row.service) ? 0 : 4) +
    (said !== null && row.frequency !== null && Math.abs(row.frequency - said) < 0.05 ? 2 : 0) +
    (wanted.state && row.state === wanted.state.toUpperCase() ? 1 : 0);
  return candidates.reduce((best, row) => (score(row) > score(best) ? row : best));
}

export function placementFor(site: Transmitter): Placement {
  const placement: Placement = {
    lat: site.lat,
    lon: site.lon,
    rangeMiles: rangeFor(site.erpKw, site.service),
    community: site.community,
  };
  if (site.service !== "AM" && site.frequency !== null) placement.frequencyMhz = site.frequency;
  return placement;
}

/** The query's reply is Latin-1; read it byte for byte. */
function latin1(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    text += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return text;
}

async function queryFcc(service: Service, callSign: string): Promise<Transmitter[]> {
  const response = await fetch(queryUrl(service, callSign), {
    headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    signal: AbortSignal.timeout(FCC_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`FCC ${service} query answered ${response.status}`);
  const text = latin1(new Uint8Array(await response.arrayBuffer()));
  return text.split(/\r?\n/).flatMap((line) => parseFccRow(line) ?? []);
}

/** Ask the FCC where one accepted station's transmitter is, and record it. */
export const placeStation = internalAction({
  args: { id: v.id("freightFateStationSuggestions") },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.freightFateStations.stationForPlacement, { id: args.id });
    if (!row) return { placed: false };
    let site: Transmitter | null = null;
    try {
      for (const service of servicesFor(row.frequency)) {
        site = pickTransmitter(await queryFcc(service, callSignBase(row.callSign)), row);
        if (site) break;
      }
    } catch (error) {
      // The query being down is not "the FCC does not list it": leave the
      // row unmarked so the next re-check asks again.
      console.warn(`Station placement for ${args.id} not checked: ${String(error)}`);
      return { placed: false };
    }
    await ctx.runMutation(internal.freightFateStations.recordStationPlacement, {
      id: args.id,
      placement: site ? placementFor(site) : null,
      now: Date.now(),
    });
    return { placed: site !== null };
  },
});
