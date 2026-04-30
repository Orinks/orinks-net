"use client";

import { useEffect, useMemo, useState } from "react";

type WeatherResponse = {
  lines?: string[];
  updatedAt?: string;
  source?: string;
  error?: string;
};

type VisitResponse = {
  count?: number;
  durable?: boolean;
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

export function HomeStatusPanel({ variant = "page" }: HomeStatusPanelProps) {
  const [now, setNow] = useState(() => new Date());
  const [visitorCount, setVisitorCount] = useState<number | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);

  const localTime = useMemo(() => timeFormatter.format(now), [now]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const storedCount = window.sessionStorage.getItem("orinks-home-visit-count");

    if (storedCount) {
      setVisitorCount(Number(storedCount));
    }

    if (window.sessionStorage.getItem("orinks-home-visit-counted")) {
      void fetch("/api/visits")
        .then((response) => response.json() as Promise<VisitResponse>)
        .then((data) => {
          if (typeof data.count === "number") {
            window.sessionStorage.setItem("orinks-home-visit-count", String(data.count));
            setVisitorCount(data.count);
          }
        })
        .catch(() => {
          setVisitorCount(storedCount ? Number(storedCount) : null);
        });
      return;
    }

    window.sessionStorage.setItem("orinks-home-visit-counted", "true");

    void fetch("/api/visits", { method: "POST" })
      .then((response) => response.json() as Promise<VisitResponse>)
      .then((data) => {
        if (typeof data.count === "number") {
          window.sessionStorage.setItem("orinks-home-visit-count", String(data.count));
          setVisitorCount(data.count);
        }
      })
      .catch(() => {
        setVisitorCount(null);
      });
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
        <p className="mt-2 text-sm text-slate-700">
          Visitor count: {visitorCount == null ? "Counting..." : visitorCount.toLocaleString("en-US")}
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
