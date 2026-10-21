import { unstable_cache } from "next/cache";
import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";
import type { WhatsNewEntry } from "@/lib/whats-new";

/** One accepted station, as freightFateStations.listStationNews returns it. */
export type StationNews = {
  name: string;
  kind: "terrestrial" | "web";
  acceptedAt: number;
  callSign?: string;
  frequency?: string;
  city?: string;
  state?: string;
  genre?: string;
};

// The owner's day, the same clock the visitor counter keeps: stations
// accepted in one evening's review share one announcement.
const SITE_TIME_ZONE = "America/New_York";

// Matches the community station list's snapshot: an accepted station shows
// up here about when the game first downloads it.
const STATION_NEWS_SECONDS = 600;

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

/** One announcement per day the owner accepted stations, newest first. */
export function stationNewsEntries(stations: StationNews[]): WhatsNewEntry[] {
  const byDay = new Map<string, StationNews[]>();
  for (const station of stations) {
    const date = siteDate(station.acceptedAt);
    byDay.set(date, [...(byDay.get(date) ?? []), station]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, day]) => {
      const sorted = [...day].sort((a, b) => a.name.localeCompare(b.name));
      return {
        id: `${date}-new-radio-stations`,
        date,
        project: "Freight Fate",
        title: stationTitle(sorted.map((station) => station.name)),
        body: [
          ...sorted.map(stationLine),
          `${sorted.length === 1 ? "It will be" : "They will be"} on the dial the next time you start the game.`,
        ],
        link: { href: "/freight-fate/suggest-a-station", label: "Suggest a radio station" },
      };
    });
}

async function readStationNews(): Promise<StationNews[]> {
  const client = getConvexClient();
  if (!client) return [];
  return client.query(anyApi.freightFateStations.listStationNews, {});
}

const cachedStationNews = unstable_cache(readStationNews, ["freight-fate-station-news"], {
  revalidate: STATION_NEWS_SECONDS,
});

/**
 * The station announcements, or none when the backend is unreachable: the
 * curated entries must still render, and a failed read is not cached.
 */
export async function getStationNewsEntries(): Promise<WhatsNewEntry[]> {
  try {
    return stationNewsEntries(await cachedStationNews());
  } catch (error) {
    console.error("What's New could not read the accepted stations", error);
    return [];
  }
}
