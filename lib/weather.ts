const LUMBERTON = {
  name: "Lumberton, New Jersey",
  latitude: 39.9659,
  longitude: -74.8052,
};

type NwsPoints = {
  properties?: {
    observationStations?: string;
  };
};

type NwsStationList = {
  features?: Array<{
    id?: string;
    properties?: {
      name?: string | null;
    };
  }>;
};

type NwsObservation = {
  properties?: {
    textDescription?: string | null;
    timestamp?: string | null;
    temperature?: Quantity | null;
    dewpoint?: Quantity | null;
    windSpeed?: Quantity | null;
    windGust?: Quantity | null;
    windDirection?: Quantity | null;
    relativeHumidity?: Quantity | null;
    barometricPressure?: Quantity | null;
    visibility?: Quantity | null;
    cloudLayers?: Array<{ amount?: string | null }> | null;
  };
};

type Quantity = {
  value?: number | null;
  unitCode?: string;
};

type StationObservation = {
  stationName: string | null | undefined;
  observation: NwsObservation;
};

export type CurrentConditions = {
  location: string;
  updatedAt: string;
  lines: string[];
  source: string;
};

const nwsHeaders = {
  "User-Agent": "orinks.net weather panel, contact: https://orinks.net/contact",
  Accept: "application/geo+json, application/json",
};

export async function getCurrentConditions(): Promise<CurrentConditions> {
  const points = await getJson<NwsPoints>(
    `https://api.weather.gov/points/${LUMBERTON.latitude},${LUMBERTON.longitude}`,
  );

  const stationUrl = points.properties?.observationStations;

  if (!stationUrl) {
    throw new Error("NWS point metadata did not include an observation stations URL.");
  }

  const stations = await getJson<NwsStationList>(stationUrl);
  const observation = await getBestObservation(stations);

  const props = observation.observation.properties ?? {};
  const stationLine = observation.stationName ? ` (${observation.stationName})` : "";

  return {
    location: LUMBERTON.name,
    updatedAt: props.timestamp ?? new Date().toISOString(),
    source: "National Weather Service",
    lines: [
      `Current conditions for ${LUMBERTON.name}: ${props.textDescription || "Unavailable"}`,
      `Temperature: ${formatFahrenheit(props.temperature)}`,
      `Dewpoint: ${formatFahrenheit(props.dewpoint)}`,
      `Wind: ${formatWind(props.windSpeed, props.windGust, props.windDirection)}`,
      `Humidity: ${formatPercent(props.relativeHumidity)}`,
      `Pressure: ${formatPressure(props.barometricPressure)}`,
      `Visibility: ${formatMiles(props.visibility)}`,
      `Cloud cover: ${formatCloudCover(props.cloudLayers)}`,
      `Data from: National Weather Service${stationLine}`,
    ],
  };
}

async function getBestObservation(stations: NwsStationList): Promise<StationObservation> {
  const stationCandidates = stations.features?.filter((station) => station.id).slice(0, 8) ?? [];

  if (stationCandidates.length === 0) {
    throw new Error("NWS did not return an observation station for Lumberton.");
  }

  const observationResults = await Promise.allSettled(
    stationCandidates.map(async (station) => ({
      stationName: station.properties?.name,
      observation: await getJson<NwsObservation>(`${station.id}/observations/latest`),
    })),
  );
  const observations: StationObservation[] = observationResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

  const best = observations
    .map((entry) => ({
      ...entry,
      score: scoreObservation(entry.observation),
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score === 0) {
    throw new Error("NWS did not return usable current observations for nearby stations.");
  }

  return best;
}

function scoreObservation(observation: NwsObservation) {
  const props = observation.properties;

  if (!props) {
    return 0;
  }

  return [
    props.textDescription,
    props.temperature?.value,
    props.dewpoint?.value,
    props.windSpeed?.value,
    props.relativeHumidity?.value,
    props.visibility?.value,
  ].filter((value) => value !== null && value !== undefined && value !== "").length;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: nwsHeaders,
    next: { revalidate: 600 },
  });

  if (!response.ok) {
    throw new Error(`NWS request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function formatFahrenheit(quantity?: Quantity | null) {
  if (quantity?.value == null) {
    return "Unavailable";
  }

  return `${Math.round((quantity.value * 9) / 5 + 32)}°F`;
}

function formatPercent(quantity?: Quantity | null) {
  if (quantity?.value == null) {
    return "Unavailable";
  }

  return `${Math.round(quantity.value)}%`;
}

function formatPressure(quantity?: Quantity | null) {
  if (quantity?.value == null) {
    return "Unavailable";
  }

  return `${Math.round(quantity.value / 3386.389)} inHg`;
}

function formatMiles(quantity?: Quantity | null) {
  if (quantity?.value == null) {
    return "Unavailable";
  }

  return `${Math.round((quantity.value / 1609.344) * 10) / 10} mi`;
}

function formatWind(speed?: Quantity | null, gust?: Quantity | null, direction?: Quantity | null) {
  const mph = speed?.value == null ? null : Math.round(speed.value * 0.621371);
  const gustMph = gust?.value == null ? 0 : Math.round(gust.value * 0.621371);

  if (mph == null) {
    return "Unavailable";
  }

  const base = mph === 0 ? "Calm" : `${formatCompass(direction?.value)} at ${mph} mph`;
  return gustMph > 0 ? `${base}, gusting to ${gustMph} mph` : base;
}

function formatCompass(degrees?: number | null) {
  if (degrees == null) {
    return "Unknown";
  }

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length];
}

function formatCloudCover(layers?: Array<{ amount?: string | null }> | null) {
  if (!layers || layers.length === 0) {
    return "0%";
  }

  const coverByCode: Record<string, string> = {
    CLR: "0%",
    FEW: "25%",
    SCT: "50%",
    BKN: "75%",
    OVC: "100%",
  };

  return coverByCode[layers[0]?.amount ?? ""] ?? "Unavailable";
}
