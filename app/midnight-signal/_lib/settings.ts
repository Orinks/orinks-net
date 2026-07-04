// Player identity and settings, persisted in localStorage. Everything here is
// client-only; guard against SSR by checking typeof window.

const KEY_PREFIX = "midnight-signal:";

export interface GameSettings {
  hostVolume: number; // 0..1
  autoPlayQuestionAudio: boolean;
  producerVoice: boolean; // speechSynthesis; OFF by default for screen reader users
  captions: boolean;
  numberShortcuts: boolean; // 1-4 answer keys + R replay (WCAG 2.1.4 requires this toggle)
  reducedMotion: "system" | "on" | "off";
}

export const defaultSettings: GameSettings = {
  hostVolume: 0.8,
  // OFF by default: focus movement already makes the screen reader speak the
  // question; auto-playing the same words as MP3 would double-speak (a11y review P0-1)
  autoPlayQuestionAudio: false,
  producerVoice: false,
  captions: true,
  numberShortcuts: true,
  reducedMotion: "system",
};

export function loadSettings(): GameSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}settings`);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: GameSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${KEY_PREFIX}settings`, JSON.stringify(settings));
}

export function getPlayerKey(): string {
  if (typeof window === "undefined") return "";
  let key = window.localStorage.getItem(`${KEY_PREFIX}playerKey`);
  if (!key) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(`${KEY_PREFIX}playerKey`, key);
  }
  return key;
}

export function getStoredName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(`${KEY_PREFIX}displayName`) ?? "";
}

export function storeName(name: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${KEY_PREFIX}displayName`, name);
}
