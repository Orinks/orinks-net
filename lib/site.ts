export const site = {
  name: "Josh's Domain",
  description:
    "The digital home of Joshua Tubbs, a YouTuber, Twitch streamer, flight simulation enthusiast, and accessibility evangelist.",
  url: "https://orinks.net",
};

export const navItems = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/playlists", label: "Playlists" },
  { href: "/projects", label: "Projects" },
  { href: "/games", label: "Games" },
  { href: "/game-mods", label: "Game Mods" },
];

export const projectNav = [
  { href: "/accessiweather", label: "AccessiWeather" },
  { href: "/portkeydrop", label: "PortkeyDrop" },
  { href: "/station-scout", label: "Station Scout" },
  { href: "/accessiclock", label: "AccessiClock" },
  { href: "/spectra", label: "Spectra" },
  { href: "/freight-fate", label: "Freight Fate" },
];

export const gameModNav = [{ href: "/eurofly-enhanced-mod", label: "Eurofly Enhanced Mod" }];

export const gamesNav = [
  { href: "/games/space-colony-defense/index.html", label: "Space Colony Defense" },
];

export const socialLinks = [
  { href: "http://youtube.com/@orin8722", label: "YouTube" },
  { href: "https://twitch.tv/orinks1", label: "Twitch" },
  { href: "https://storiesonline.net/a/orinks", label: "StoriesOnline" },
  { href: "https://x.com/orinks33", label: "X" },
  { href: "https://facebook.com/orinks", label: "Facebook" },
  { href: "https://github.com/Orinks", label: "GitHub" },
];

export type ProjectPage = {
  href: string;
  title: string;
  tagline: string;
  summary: string;
  status: string;
  audience: string;
  features: string[];
  links: { href: string; label: string }[];
  downloadsHref?: string;
  manualHref?: string;
};

export const projectSummaries: ProjectPage[] = [
  {
    href: "/accessiweather",
    title: "AccessiWeather",
    tagline: "A free desktop weather app. For the casual check-in or the deep dive.",
    summary:
      "AccessiWeather brings forecasts, alerts, and detailed weather data into one open-source desktop app for Windows, macOS, and Linux. Everything lives in clearly separated sections, so you can jump straight to what you need.",
    status: "Stable releases and nightly builds are available.",
    audience: "Tested with NVDA, JAWS, and VoiceOver.",
    features: [
      "Current conditions, daily and hourly forecasts, and severe weather alerts, organized into focused sections that don't get in your way.",
      "US and international coverage from the National Weather Service, Open-Meteo, and Pirate Weather, with an Automatic mode that fuses the best sources for your region.",
      "For weather enthusiasts: air quality, UV index, aviation weather, weather history, marine forecasts, NOAA Weather Radio, and Forecaster Notes for full NWS text products.",
      "Optional AI explanations and a Weather Assistant chat through OpenRouter, for when a forecast needs to be put in plain language.",
      "Desktop notifications with optional sound packs, plus minute-by-minute precipitation timelines and adaptive rain alerts.",
    ],
    downloadsHref: "/accessiweather/downloads",
    manualHref: "/accessiweather/user-manual",
    links: [
      { href: "https://github.com/Orinks/AccessiWeather", label: "GitHub repository" },
      { href: "https://github.com/Orinks/AccessiWeather/issues", label: "Report an issue" },
    ],
  },
  {
    href: "/portkeydrop",
    title: "PortkeyDrop",
    tagline: "A keyboard-first file transfer client that works the way you do.",
    summary:
      "PortkeyDrop is a desktop client for SFTP, FTP, FTPS, and WebDAV. Connect to your servers, move files, and track every transfer without ever reaching for a mouse.",
    status: "Stable releases and nightly builds are available.",
    audience: "Tested with NVDA, JAWS, and VoiceOver.",
    features: [
      "One client for SFTP, FTP, FTPS, and WebDAV, so there's no juggling separate apps.",
      "Dual-pane layout for local and remote files, with clear labels and full keyboard navigation throughout.",
      "Quick Connect and Site Manager keep your saved servers a keystroke away.",
      "Connection passwords are stored in your system's secure keyring, never written to disk in plaintext.",
      "Transfer progress, queue, and errors are shown as plain, readable status text, so you always know where things stand.",
    ],
    downloadsHref: "/portkeydrop/downloads",
    links: [
      { href: "https://github.com/Orinks/PortkeyDrop", label: "GitHub repository" },
      { href: "https://github.com/Orinks/PortkeyDrop/issues", label: "Report an issue" },
    ],
  },
  {
    href: "/station-scout",
    title: "Station Scout",
    tagline: "Internet radio that remembers what you heard, when you want it to.",
    summary:
      'Ever caught a song on an internet radio station and thought "what was that?" By the time you have reached for Shazam, the song is over. Station Scout is an internet radio player that catches every song so you do not have to. Find stations through Radio Browser, paste in a direct URL, or tune into your regulars.',
    status: "Station Scout v1.0.0 is available for Windows, macOS, and Linux.",
    audience:
      "When you want a session logged, turn tracking on. When the session ends, choose whether to save it locally or turn it into a Spotify playlist. For the shows you actually plan around, set timers per station or per show. Tracking starts and stops on its own, so you can capture a favorite internet DJ's set without watching the clock.",
    features: [
      "Browse thousands of stations through Radio Browser, or paste a direct stream URL to play anything.",
      "Tracking is off by default, turn it on whenever you want a listening session logged.",
      "At the end of a tracked session, choose to save it locally or turn it into a Spotify playlist.",
      "Scrobbles to Last.fm in real time when you want it to.",
      "Per-station and per-show timers that start and stop tracking automatically, so you can capture a specific DJ's set.",
    ],
    downloadsHref: "/station-scout/downloads",
    links: [
      { href: "https://github.com/Orinks/station-scout", label: "GitHub repository" },
      { href: "https://github.com/Orinks/station-scout/issues", label: "Report an issue" },
    ],
  },
  {
    href: "/accessiclock",
    title: "AccessiClock",
    tagline: "A planned accessible desktop clock.",
    summary: "An accessible clock application for Windows. Coming soon.",
    status: "In development.",
    audience:
      "Planned for users who want a straightforward clock experience that works naturally with screen readers and the keyboard.",
    features: [
      "Screen reader-first time and clock surfaces.",
      "A quiet desktop workflow for common clock tasks.",
      "Downloads will be added after the first public build is ready.",
    ],
    downloadsHref: "/accessiclock/downloads",
    links: [{ href: "https://github.com/Orinks", label: "Orinks on GitHub" }],
  },
  {
    href: "/spectra",
    title: "Spectra",
    tagline: "A screen-reader-first OpenAPI documentation browser and REST client.",
    summary:
      "A screen-reader-first OpenAPI documentation browser and REST client. Coming soon.",
    status: "In development.",
    audience:
      "Built for developers who need to inspect OpenAPI descriptions, endpoints, and request details without fighting a visual-only docs UI.",
    features: [
      "OpenAPI navigation shaped around headings, lists, and predictable keyboard movement.",
      "REST request workflows that keep response details readable.",
      "Downloads will be added after the first public release is ready.",
    ],
    downloadsHref: "/spectra/downloads",
    links: [{ href: "https://github.com/Orinks/spectra", label: "GitHub repository" }],
  },
  // Keep Freight Fate last: the home page features only the first four
  // projects, and this one is intentionally not featured.
  {
    href: "/freight-fate",
    title: "Freight Fate",
    tagline: "An audio trucking adventure across America.",
    summary:
      "Freight Fate is an audio-first trucking simulation for Windows and Linux. Build a freight career across 59 cities on real interstate corridors: pick up jobs, plan routes, and drive a ten-speed Class 8 truck with realistic physics, entirely by sound. Every menu, gauge, and road event is spoken, with a visible text mirror for sighted helpers.",
    status: "Stable releases and developer snapshots are available.",
    audience:
      "Designed for screen reader users first. Speech is delivered through Prism, which works with NVDA, JAWS, SAPI, VoiceOver, and Speech Dispatcher, and the whole game is played from the keyboard.",
    features: [
      "Truck physics you can hear: a ten-speed transmission (manual with clutch or automatic), torque, grades, traction limits, brake fade, and an engine note that tracks RPM in real time.",
      "A living map: 59 cities and 106 legs along real interstates, regional freight identity, cargo markets that drift day by day, and multiple route options per job.",
      "Dynamic weather and a day/night cycle with audio ambience, road hazards, and forecasts along your route, optionally driven by real-world conditions.",
      "Hours of service and fatigue: plan breaks and overnight parking around an 11-hour driving clock while delivery deadlines keep counting.",
      "A full career: experience levels, reputation, cargo endorsements, truck upgrades, a second truck, and mid-trip save and resume.",
      "Every sound and music track is procedurally synthesized and dedicated to the public domain.",
    ],
    downloadsHref: "/freight-fate/downloads",
    links: [
      { href: "https://github.com/Orinks/Freight-Fate", label: "GitHub repository" },
      { href: "https://github.com/Orinks/Freight-Fate/issues", label: "Report an issue" },
    ],
  },
];

export function getProject(href: string) {
  return projectSummaries.find((project) => project.href === href);
}
