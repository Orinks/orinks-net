export const DEFAULT_USER_AGENT =
  "orinks-net-midnight-signal-editorial-collector/1.0 (+https://orinks.net)";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const name of ["api_key", "apikey", "key", "token", "access_token"]) {
      if (url.searchParams.has(name)) url.searchParams.set(name, "[redacted]");
    }
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1_000));
    const dateDelay = new Date(retryAfter).valueOf() - Date.now();
    if (Number.isFinite(dateDelay)) return Math.min(10_000, Math.max(0, dateDelay));
  }
  return Math.min(5_000, 750 * 2 ** attempt);
}

function requestError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

export async function requestJson(
  url,
  {
    fetchImpl = fetch,
    headers = {},
    maxRetries = 2,
    sleepImpl = sleep,
    timeoutMs = 15_000,
  } = {},
) {
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new Error("maxRetries must be an integer from 0 through 5");
  }

  const safeUrl = redactUrl(url);
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": DEFAULT_USER_AGENT,
          ...headers,
        },
        signal: controller.signal,
      });
      const body = await response.text();
      const bodySnippet = body.slice(0, 500);
      if (!response.ok) {
        lastError = requestError(`${safeUrl} returned HTTP ${response.status}`, {
          bodySnippet,
          status: response.status,
          url: safeUrl,
        });
        if (!RETRYABLE_STATUS.has(response.status)) throw lastError;
      } else {
        try {
          return JSON.parse(body);
        } catch {
          throw requestError(`${safeUrl} did not return valid JSON`, {
            bodySnippet,
            status: response.status,
            url: safeUrl,
          });
        }
      }
    } catch (error) {
      if (error?.status && !RETRYABLE_STATUS.has(error.status)) throw error;
      lastError = error?.name === "AbortError"
        ? requestError(`${safeUrl} timed out after ${timeoutMs}ms`, { url: safeUrl })
        : error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxRetries) {
      await sleepImpl(retryDelay(response, attempt));
    }
  }

  const attempts = maxRetries + 1;
  const wrapped = requestError(
    `Request to ${safeUrl} failed after ${attempts} attempts: ${lastError?.message ?? "unknown error"}`,
    {
      bodySnippet: lastError?.bodySnippet,
      cause: lastError,
      status: lastError?.status,
      url: safeUrl,
    },
  );
  throw wrapped;
}

export function createRateLimitedRequester({
  minIntervalMs,
  now = Date.now,
  sleepImpl = sleep,
  ...requestOptions
}) {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new Error("minIntervalMs must be a non-negative number");
  }
  let previousStartedAt = 0;
  let queue = Promise.resolve();

  return (url, options = {}) => {
    const task = queue.then(async () => {
      const wait = previousStartedAt + minIntervalMs - now();
      if (wait > 0) await sleepImpl(wait);
      previousStartedAt = now();
      return requestJson(url, {
        ...requestOptions,
        ...options,
        headers: { ...requestOptions.headers, ...options.headers },
      });
    });
    queue = task.catch(() => {});
    return task;
  };
}
