import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";
import type { WhatsNewEntry } from "@/lib/whats-new";

/** One accepted station, as the announcement recorded it. */
export type StationNews = {
  name: string;
  kind: "terrestrial" | "web";
  callSign?: string;
  frequency?: string;
  city?: string;
  state?: string;
  genre?: string;
};

/** One accepted batch, as freightFateStationNews.listStationNews returns it. */
export type StationBatch = { createdAt: number; stations: StationNews[] };

// Announcements are dated by the owner's day, the same clock the visitor
// counter keeps, so an evening review is not dated tomorrow.
const SITE_TIME_ZONE = "America/New_York";

function siteDate(ms: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: SITE_TIME_ZONE,
    year: "numeric",
  }).formatToParts(new Date(ms));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function stationLine(station: StationNews) {
  if (station.kind === "web") {
    return station.genre
      ? `${station.name}, an online station playing ${station.genre}.`
      : `${station.name}, an online station.`;
  }
  const signal = [station.callSign !== station.name ? station.callSign : undefined, station.frequency]
    .filter(Boolean)
    .join(" ");
  const place = [station.city, station.state].filter(Boolean).join(", ");
  return [station.name, signal, place ? `from ${place}` : ""].filter(Boolean).join(", ") + ".";
}

function stationTitle(names: string[]) {
  if (names.length === 1) return `${names[0]} joins Freight Fate's radio`;
  if (names.length === 2) return `${names[0]} and ${names[1]} join Freight Fate's radio`;
  return `${names.length} new stations join Freight Fate's radio`;
}

/**
 * One announcement per accepted batch, newest first. A second batch on the
 * same day gets "-2" on its id, a third "-3", in the order they were accepted.
 */
export function stationNewsEntries(batches: StationBatch[]): WhatsNewEntry[] {
  const perDay = new Map<string, number>();
  return [...batches]
    .filter((batch) => batch.stations.length > 0)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((batch) => {
      const date = siteDate(batch.createdAt);
      const count = (perDay.get(date) ?? 0) + 1;
      perDay.set(date, count);
      const sorted = [...batch.stations].sort((a, b) => a.name.localeCompare(b.name));
      return {
        id: count === 1 ? `${date}-new-radio-stations` : `${date}-new-radio-stations-${count}`,
        date,
        project: "Freight Fate",
        title: stationTitle(sorted.map((station) => station.name)),
        body: [
          ...sorted.map(stationLine),
          `${sorted.length === 1 ? "It will be" : "They will be"} on the dial the next time you start the game.`,
        ],
        link: { href: "/freight-fate/suggest-a-station", label: "Suggest a radio station" },
      };
    })
    .reverse();
}

/**
 * The station announcements, read fresh on every request so a batch shows up
 * as soon as it is accepted, or none when the backend is unreachable: the
 * curated entries must still render.
 */
export async function getStationNewsEntries(): Promise<WhatsNewEntry[]> {
  const client = getConvexClient();
  if (!client) return [];
  try {
    return stationNewsEntries(await client.query(anyApi.freightFateStationNews.listStationNews, {}));
  } catch (error) {
    console.error("What's New could not read the station announcements", error);
    return [];
  }
}
