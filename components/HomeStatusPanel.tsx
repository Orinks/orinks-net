"use client";

import { useEffect, useMemo, useState } from "react";

type WeatherResponse = {
  lines?: string[];
  updatedAt?: string;
  source?: string;
  error?: string;
};

type VisitResponse = {
  lifetime?: number;
  today?: number;
  environmentKey?: string;
  todayKey?: string;
  durable?: boolean;
  error?: string;
};

type HomeStatusPanelProps = {
  variant?: "page" | "footer";
};

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

const visitCountsStorageKey = "orinks-home-visit-counts";
const visitCountedStoragePrefix = "orinks-home-visit-counted";

function isVisitCountResponse(data: VisitResponse): data is Required<Pick<VisitResponse, "lifetime" | "today" | "environmentKey" | "todayKey">> {
  return (
    typeof data.lifetime === "number" &&
    typeof data.today === "number" &&
    typeof data.environmentKey === "string" &&
    typeof data.todayKey === "string"
  );
}

function getVisitCountedStorageKey(data: Pick<VisitResponse, "environmentKey" | "todayKey">) {
  return `${visitCountedStoragePrefix}:${data.environmentKey}:${data.todayKey}`;
}

function readStoredVisitCounts() {
  const storedCounts = window.sessionStorage.getItem(visitCountsStorageKey);

  if (!storedCounts) {
    return null;
  }

  try {
    const data = JSON.parse(storedCounts) as VisitResponse;
    return isVisitCountResponse(data) ? data : null;
  } catch {
    return null;
  }
}

function storeVisitCounts(data: VisitResponse) {
  if (!isVisitCountResponse(data)) {
    return;
  }

  window.sessionStorage.setItem(
    visitCountsStorageKey,
    JSON.stringify({
      lifetime: data.lifetime,
      today: data.today,
      environmentKey: data.environmentKey,
      todayKey: data.todayKey,
    }),
  );
}

export function HomeStatusPanel({ variant = "page" }: HomeStatusPanelProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [visitCounts, setVisitCounts] = useState<Pick<VisitResponse, "lifetime" | "today"> | null>(null);
  const [visitorUnavailable, setVisitorUnavailable] = useState(false);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);

  const localTime = useMemo(() => (now ? timeFormatter.format(now) : "Loading local time..."), [now]);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const storedCounts = readStoredVisitCounts();

    if (storedCounts) {
      setVisitCounts({ lifetime: storedCounts.lifetime, today: storedCounts.today });
    }

    async function refreshVisitCounts() {
      try {
        const response = await fetch("/api/visits");
        const data = (await response.json()) as VisitResponse;

        if (!isVisitCountResponse(data)) {
          setVisitorUnavailable(!storedCounts);
          return;
        }

        const countedStorageKey = getVisitCountedStorageKey(data);

        if (window.sessionStorage.getItem(countedStorageKey)) {
          storeVisitCounts(data);
          setVisitCounts({ lifetime: data.lifetime, today: data.today });
          return;
        }

        const postResponse = await fetch("/api/visits", { method: "POST" });
        const postData = (await postResponse.json()) as VisitResponse;

        if (!isVisitCountResponse(postData)) {
          setVisitorUnavailable(!storedCounts);
          return;
        }

        window.sessionStorage.setItem(getVisitCountedStorageKey(postData), "true");
        storeVisitCounts(postData);
        setVisitCounts({ lifetime: postData.lifetime, today: postData.today });
      } catch {
        setVisitorUnavailable(!storedCounts);
        setVisitCounts(storedCounts ? { lifetime: storedCounts.lifetime, today: storedCounts.today } : null);
      }
    }

    void refreshVisitCounts();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshWeather() {
      setWeatherLoading(true);

      try {
        const response = await fetch("/api/current-conditions");
        const data = (await response.json()) as WeatherResponse;

        if (!cancelled) {
          setWeather(data);
        }
      } catch {
        if (!cancelled) {
          setWeather({
            error: "Weather unavailable.",
            lines: [
              "Current conditions for Lumberton, New Jersey: Unavailable",
              "Data from: National Weather Service",
            ],
          });
        }
      } finally {
        if (!cancelled) {
          setWeatherLoading(false);
        }
      }
    }

    void refreshWeather();
    const timer = window.setInterval(refreshWeather, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const isFooter = variant === "footer";
  const headingId = isFooter ? "footer-time-temperature" : "time-temperature";

  return (
    <section aria-labelledby={headingId} className={isFooter ? "mb-8" : "py-8"}>
      <h2 className={isFooter ? "mb-3 text-xl font-bold text-ink" : "mb-4 text-2xl font-bold text-ink"} id={headingId}>
        Time &amp; Temperature
      </h2>
      <div className="rounded-lg border border-line bg-white p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-action">Lumberton, New Jersey</p>
        <p className="mt-2 font-semibold text-ink">Local time: {localTime}</p>
        <p aria-atomic="true" className="mt-2 text-sm text-slate-700" role="status">
          All-time visitors:{" "}
          {visitCounts == null
            ? visitorUnavailable
              ? "Unavailable"
              : "Counting..."
            : `${visitCounts.lifetime?.toLocaleString("en-US")}. Today: ${visitCounts.today?.toLocaleString(
                "en-US",
              )}`}
        </p>

        <div className="mt-5 border-t border-line pt-5" aria-live="polite">
          {weatherLoading && !weather ? (
            <p className="text-slate-700">Loading current conditions...</p>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-base leading-7 text-slate-800">
              {(weather?.lines ?? []).join("\n")}
            </pre>
          )}
          {weather?.updatedAt ? (
            <p className="mt-3 text-sm text-slate-600">
              Updated {new Intl.DateTimeFormat("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "America/New_York",
              }).format(new Date(weather.updatedAt))}
            </p>
          ) : null}
          {weather?.error ? <p className="mt-3 text-sm text-red-700">{weather.error}</p> : null}
        </div>
      </div>
    </section>
  );
}
