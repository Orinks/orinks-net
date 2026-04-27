const LUMBERTON = {
  name: "Lumberton, New Jersey",
  latitude: 39.9659,
  longitude: -74.8052,
  timeZone: "America/New_York",
};

type NwsPoints = {
  properties?: {
    observationStations?: string;
    forecastHourly?: string;
  };
};

type NwsStationList = {
  features?: Array<{
    id?: string;
  }>;
};

type NwsObservation = {
  properties?: {
    textDescription?: string | null;
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

type NwsHourlyForecast = {
  properties?: {
    periods?: NwsHourlyPeriod[];
  };
};

type Quantity = {
  value?: number | null;
  unitCode?: string;
};

type NwsHourlyPeriod = {
  shortForecast?: string;
  temperature?: number;
  probabilityOfPrecipitation?: Quantity | null;
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
  const hourlyUrl = points.properties?.forecastHourly;

  if (!stationUrl || !hourlyUrl) {
    throw new Error("NWS point metadata did not include observation or hourly forecast URLs.");
  }

  const stations = await getJson<NwsStationList>(stationUrl);
  const firstStation = stations.features?.find((station) => station.id)?.id;

  if (!firstStation) {
    throw new Error("NWS did not return an observation station for Lumberton.");
  }

  const [observation, hourly] = await Promise.all([
    getJson<NwsObservation>(`${firstStation}/observations/latest`),
    getJson<NwsHourlyForecast>(hourlyUrl),
  ]);

  const props = observation.properties ?? {};
  const firstHour = hourly.properties?.periods?.[0];
  const secondHour = hourly.properties?.periods?.[1];
  const trend = getTemperatureTrend(props.temperature?.value, secondHour?.temperature);

  return {
    location: LUMBERTON.name,
    updatedAt: new Date().toISOString(),
    source: "National Weather Service",
    lines: [
      `Current conditions for ${LUMBERTON.name}: ${props.textDescription || "Unavailable"}`,
      `Precipitation outlook: ${formatPrecipitationOutlook(firstHour)}`,
      `Temperature: ${formatFahrenheit(props.temperature)}`,
      `Dewpoint: ${formatFahrenheit(props.dewpoint)}`,
      `Wind: ${formatWind(props.windSpeed, props.windGust, props.windDirection)}`,
      `Humidity: ${formatPercent(props.relativeHumidity)}`,
      `Pressure: ${formatPressure(props.barometricPressure)}`,
      `Visibility: ${formatMiles(props.visibility)}`,
      `Cloud cover: ${formatCloudCover(props.cloudLayers)}`,
      formatSun("Sunrise"),
      formatSun("Sunset"),
      `Moon phase: ${getMoonPhase(new Date())}`,
      `Temperature trend: ${trend}`,
      "Data from: National Weather Service",
    ],
  };
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

function formatPrecipitationOutlook(period?: NwsHourlyPeriod) {
  if (!period) {
    return "Unavailable";
  }

  const chance = period.probabilityOfPrecipitation?.value;
  const forecast = period.shortForecast || "conditions unavailable";

  if (chance == null || chance === 0) {
    return `${forecast} for the hour.`;
  }

  return `${forecast} for the hour, ${Math.round(chance)}% chance of precipitation.`;
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

function formatSun(label: "Sunrise" | "Sunset") {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: LUMBERTON.timeZone,
  });

  const date = new Date();
  const dayOfYear = getDayOfYear(date);
  const lngHour = LUMBERTON.longitude / 15;
  const approximateTime = dayOfYear + ((label === "Sunrise" ? 6 : 18) - lngHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude =
    meanAnomaly +
    1.916 * Math.sin(toRadians(meanAnomaly)) +
    0.02 * Math.sin(toRadians(2 * meanAnomaly)) +
    282.634;
  const normalizedLongitude = normalizeDegrees(trueLongitude);
  const rightAscension = normalizeDegrees(toDegrees(Math.atan(0.91764 * Math.tan(toRadians(normalizedLongitude)))));
  const longitudeQuadrant = Math.floor(normalizedLongitude / 90) * 90;
  const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90;
  const adjustedRightAscension = (rightAscension + longitudeQuadrant - rightAscensionQuadrant) / 15;
  const sinDec = 0.39782 * Math.sin(toRadians(normalizedLongitude));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosHour =
    (Math.cos(toRadians(90.833)) - sinDec * Math.sin(toRadians(LUMBERTON.latitude))) /
    (cosDec * Math.cos(toRadians(LUMBERTON.latitude)));

  if (cosHour > 1 || cosHour < -1) {
    return `${label}: Unavailable`;
  }

  const localHourAngle =
    label === "Sunrise" ? 360 - toDegrees(Math.acos(cosHour)) : toDegrees(Math.acos(cosHour));
  const localMeanTime =
    localHourAngle / 15 +
    adjustedRightAscension -
    0.06571 * approximateTime -
    6.622;
  const utcHour = normalizeHours(localMeanTime - lngHour);
  const sunriseSunset = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0),
  );
  sunriseSunset.setUTCHours(Math.floor(utcHour), Math.round((utcHour % 1) * 60));

  return `${label}: ${formatter.format(sunriseSunset)}`;
}

function getTemperatureTrend(currentCelsius?: number | null, nextFahrenheit?: number) {
  if (currentCelsius == null || nextFahrenheit == null) {
    return "Unavailable";
  }

  const currentFahrenheit = (currentCelsius * 9) / 5 + 32;
  const difference = Math.round((nextFahrenheit - currentFahrenheit) * 10) / 10;
  const direction = difference > 0 ? "rising" : difference < 0 ? "falling" : "steady";
  const arrow = difference > 0 ? "↑" : difference < 0 ? "↓" : "→";

  return `Temperature ${direction} ${difference >= 0 ? "+" : ""}${difference}°F over the next hour ${arrow}`;
}

function getMoonPhase(date: Date) {
  const phases = [
    "New Moon",
    "Waxing Crescent",
    "First Quarter",
    "Waxing Gibbous",
    "Full Moon",
    "Waning Gibbous",
    "Last Quarter",
    "Waning Crescent",
  ];
  const knownNewMoon = new Date(Date.UTC(2000, 0, 6, 18, 14));
  const lunarCycleDays = 29.530588853;
  const daysSinceKnownNewMoon = (date.getTime() - knownNewMoon.getTime()) / 86400000;
  const phaseIndex = Math.floor(((daysSinceKnownNewMoon % lunarCycleDays) / lunarCycleDays) * 8 + 0.5) % 8;

  return phases[phaseIndex];
}

function getDayOfYear(date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  return Math.floor((date.getTime() - start.getTime()) / 86400000);
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function normalizeDegrees(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

function normalizeHours(hours: number) {
  return ((hours % 24) + 24) % 24;
}
