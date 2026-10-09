import { unstable_cache } from "next/cache";
import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";
import { hashFreightFateToken, normalizeFreightFateDriverId } from "@/lib/freight-fate-online";

export type FreightFateCommunityStations = {
  schema: number;
  stations: Array<Record<string, string | number | boolean>>;
};

export type FreightFateStationSuggestionResult =
  | { ok: true; message: string }
  | { ok: false; reason: string; message: string };

export const FREIGHT_FATE_STATIONS_SNAPSHOT_TAG = "freight-fate-community-stations";

// The list changes when the owner accepts a suggestion or a stream fails its
// nightly check, and the game reads it once per launch, so ten minutes of
// staleness costs nobody anything and keeps every launch off the backend.
export const FREIGHT_FATE_STATIONS_SNAPSHOT_SECONDS = 600;

async function readCommunityStations(): Promise<FreightFateCommunityStations | null> {
  const client = getConvexClient();
  if (!client) return null;
  return client.query(anyApi.freightFateStations.listCommunityStations, {});
}

/** The accepted, still-answering station suggestions, as the game reads them. */
export const getFreightFateCommunityStations = unstable_cache(
  readCommunityStations,
  [FREIGHT_FATE_STATIONS_SNAPSHOT_TAG],
  { revalidate: FREIGHT_FATE_STATIONS_SNAPSHOT_SECONDS, tags: [FREIGHT_FATE_STATIONS_SNAPSHOT_TAG] },
);

/** A station suggestion from the game, authenticated by its driver token. */
export async function suggestFreightFateStation(input: {
  driverId: string;
  driverToken: string;
  clientVersion?: string;
  form: Record<string, string>;
}): Promise<FreightFateStationSuggestionResult | null> {
  const client = getConvexClient();
  if (!client) return null;
  return client.action(anyApi.freightFateStationVetting.suggestStation, {
    driverId: normalizeFreightFateDriverId(input.driverId),
    driverTokenHash: hashFreightFateToken(input.driverToken),
    ...(input.clientVersion ? { clientVersion: input.clientVersion } : {}),
    ...input.form,
  });
}
