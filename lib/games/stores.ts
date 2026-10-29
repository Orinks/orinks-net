// The storage @hearken/online needs, kept in Convex (convex/games.ts). Each
// call carries GAMES_SERVER_SECRET, which only this server holds, and every
// token and device code is hashed before it leaves here.
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { Accounts, Claim, Limiter, Runs } from "@/lib/hearken-online";

export function hashSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function gamesServerSecret() {
  const secret = process.env.GAMES_SERVER_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export type GameStores = { accounts: Accounts; runs: Runs; limiter: Limiter };

// How long a claimed run with no reply holds before it may be claimed
// again: a request that died partway frees its run after this.
const STALE_CLAIM_MS = 120_000;

export function convexStores(input: {
  client: ConvexHttpClient;
  secret: string;
  game: string;
  connectUrl: string;
}): GameStores {
  const { client, secret, game } = input;
  const now = () => Date.now();
  return {
    accounts: {
      player: (token) => client.query(anyApi.games.playerForToken, { secret, game, tokenHash: hashSecret(token) }),
      async startActivation() {
        const started = await client.mutation(anyApi.games.startActivation, { secret, game, now: now() });
        return {
          device_code: started.deviceCode,
          user_code: started.userCode,
          verify_url: input.connectUrl,
          expires_in: started.expiresIn,
          interval: 5,
        };
      },
      pollActivation: (deviceCode) =>
        client.mutation(anyApi.games.pollActivation, {
          secret,
          game,
          deviceCodeHash: hashSecret(deviceCode),
          now: now(),
        }),
    },
    runs: {
      async claim(key, record): Promise<Claim> {
        const answer = await client.mutation(anyApi.games.claimRun, {
          secret,
          game,
          key,
          playerId: record.player,
          kind: record.kind,
          staleMs: STALE_CLAIM_MS,
          now: now(),
        });
        if (answer.claimed) return answer;
        // A finished run's reply comes back as JSON text (see completeRun);
        // no reply at all means another request is still working on it.
        const { player, replyJson } = answer.existing;
        return { claimed: false, existing: replyJson === undefined ? { player } : { player, reply: JSON.parse(replyJson) } };
      },
      async complete(key, claim, reply) {
        if (!claim.claimed) return;
        await client.mutation(anyApi.games.completeRun, {
          secret,
          game,
          key,
          nonce: claim.nonce,
          replyJson: JSON.stringify(reply ?? null),
        });
      },
      async release(key, claim) {
        if (!claim.claimed) return;
        await client.mutation(anyApi.games.releaseRun, { secret, game, key, nonce: claim.nonce });
      },
    },
    limiter: {
      // convex/games.ts counts per minute, the only window the service asks for.
      allow: (key, limit) =>
        client.mutation(anyApi.games.consumeRateLimit, { secret, key: `${game}:${key}`, limit, now: now() }),
    },
  };
}
