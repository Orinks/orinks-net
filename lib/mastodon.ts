export type MastodonPostUpdate = {
  title: string;
  description: string;
  href: string;
  source: "Mastodon";
  publishedAt: string;
  kind: "mastodon-post";
};

type MastodonAccount = {
  id?: string;
};

type MastodonStatus = {
  id?: string;
  content?: string;
  created_at?: string;
  reblog?: unknown;
  replies_count?: number;
  uri?: string;
  url?: string;
};

const DEFAULT_MASTODON_PROFILE_URL = "https://mastodon.stickbear.me/@Orinks/";
const MASTODON_TIMEOUT_MS = 5000;

function mastodonProfileUrl() {
  return process.env.MASTODON_PROFILE_URL?.trim() || DEFAULT_MASTODON_PROFILE_URL;
}

function mastodonProfile() {
  const url = new URL(mastodonProfileUrl());
  const username = url.pathname
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/^@/, "");

  if (!username) {
    throw new Error("Mastodon profile URL does not include a username.");
  }

  return {
    instanceUrl: `${url.protocol}//${url.host}`,
    username,
  };
}

async function mastodonFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 1800 },
    signal: AbortSignal.timeout(MASTODON_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Mastodon request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    return namedEntities[entity.toLowerCase()] ?? match;
  });
}

function statusText(status: MastodonStatus) {
  return decodeHtmlEntities(
    status.content
      ?.replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>\s*<p>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Public Mastodon update",
  );
}

function statusTitle(text: string) {
  if (text.length <= 80) {
    return text;
  }

  return `${text.slice(0, 77).trim()}...`;
}

export async function getRecentMastodonPosts(): Promise<MastodonPostUpdate[]> {
  const { instanceUrl, username } = mastodonProfile();
  const accountLookupUrl = new URL("/api/v1/accounts/lookup", instanceUrl);
  accountLookupUrl.searchParams.set("acct", username);

  const account = await mastodonFetch<MastodonAccount>(accountLookupUrl.toString());

  if (!account.id) {
    throw new Error("Mastodon account lookup did not return an account ID.");
  }

  const statusesUrl = new URL(`/api/v1/accounts/${account.id}/statuses`, instanceUrl);
  statusesUrl.searchParams.set("exclude_reblogs", "true");
  statusesUrl.searchParams.set("limit", "10");

  const statuses = await mastodonFetch<MastodonStatus[]>(statusesUrl.toString());
  return statuses
    .flatMap((status): MastodonPostUpdate[] => {
      if (!status.created_at || status.reblog || !status.url) {
        return [];
      }

      const text = statusText(status);

      return [
        {
          title: statusTitle(text),
          description: text,
          href: status.url,
          source: "Mastodon",
          publishedAt: status.created_at,
          kind: "mastodon-post",
        },
      ];
    })
    .slice(0, 10);
}
