// A small KV store for the Spotify playlist updates. The site's Worker binds
// VINEXT_KV_CACHE (cloudflare.config.ts); outside a Worker (next build, tests,
// local dev) an in-memory map stands in so nothing breaks.

export type SpotifyCacheStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type KvNamespaceLike = SpotifyCacheStore;

function memoryStore(): SpotifyCacheStore {
  const values = new Map<string, { value: string; expiresAt: number | null }>();
  return {
    async get(key) {
      const entry = values.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
        values.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, options) {
      const ttl = options?.expirationTtl;
      values.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : null });
    },
  };
}

let override: SpotifyCacheStore | null = null;
let fallback: SpotifyCacheStore | null = null;
let announced = false;

async function workerKv(): Promise<KvNamespaceLike | null> {
  try {
    // A variable specifier keeps next build and vitest from trying to resolve
    // the Workers-only module; inside the Worker it is a runtime builtin.
    const specifier = "cloudflare:workers";
    const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
      env?: { VINEXT_KV_CACHE?: KvNamespaceLike };
    };
    return mod.env?.VINEXT_KV_CACHE ?? null;
  } catch {
    return null;
  }
}

export async function getSpotifyCacheStore(): Promise<SpotifyCacheStore> {
  if (override) return override;
  const kv = await workerKv();
  if (kv) {
    if (!announced) console.info("Spotify cache: using Worker KV (VINEXT_KV_CACHE).");
    announced = true;
    return kv;
  }
  if (!announced) console.warn("Spotify cache: Worker KV unavailable; using in-memory fallback.");
  announced = true;
  fallback ??= memoryStore();
  return fallback;
}

/** Test hook: use the given store, or a fresh in-memory one when null. */
export function setSpotifyCacheStoreForTests(store: SpotifyCacheStore | null) {
  override = store ?? memoryStore();
}
