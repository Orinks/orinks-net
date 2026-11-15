import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { anyApi } from "convex/server";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { getConvexClient } from "@/lib/convex";
import { convexRecords } from "@/lib/games/records";
import { gamesServerSecret } from "@/lib/games/stores";
import { scorePhrase } from "@/lib/wickets-leaderboards";
import { readPlayerPage, type PlayerPage } from "@/lib/wickets-profile";
import { GamesProviders } from "@/app/games/connect/providers";
import { HidePage } from "./hide-page";

// Read per request: scores change as they are posted.
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ player: string }> };

type Loaded = { page: PlayerPage } | { hidden: string } | null;

async function load(name: string): Promise<Loaded> {
  const client = getConvexClient();
  const secret = gamesServerSecret();
  if (!client || !secret) return null;
  const player = await client.query(anyApi.games.playerForPage, { secret, name });
  if (!player) return null;
  // Names are already public on the boards, so a hidden page says so,
  // which also lets its owner show it again.
  if (player.hidden) return { hidden: player.name };
  return { page: await readPlayerPage(convexRecords(client, secret, "wickets"), player, Date.now()) };
}

function decode(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const name = decode((await params).player);
  if (!name) return { robots: { index: false } };
  return { title: `${name} in Wicket's`, robots: { index: false } };
}

function Score({ value }: { value: number | null }) {
  return <>{value === null ? "None" : scorePhrase(value)}</>;
}

export function PlayerPageView({ page }: { page: PlayerPage }) {
  return (
    <>
      <PageHeader title={page.name} />
      <Section>
        <h2 className="mb-4 text-2xl font-bold text-ink" id="ranked">Ranked bests</h2>
        {page.ranked.length === 0 ? (
          <p>No ranked scores yet.</p>
        ) : (
          <table aria-labelledby="ranked" className="w-full max-w-2xl table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-line-strong">
                <th className="py-2 pr-4" scope="col">Game</th>
                <th className="w-24 py-2 pr-4 text-right" scope="col">Daily</th>
                <th className="w-24 py-2 pr-4 text-right" scope="col">Weekly</th>
                <th className="w-24 py-2 text-right" scope="col">Monthly</th>
              </tr>
            </thead>
            <tbody>
              {page.ranked.map((row) => (
                <tr className="border-b border-line" key={row.label}>
                  <th className="break-words py-2 pr-4 font-normal" scope="row">{row.label}</th>
                  <td className="py-2 pr-4 text-right tabular-nums"><Score value={row.daily} /></td>
                  <td className="py-2 pr-4 text-right tabular-nums"><Score value={row.weekly} /></td>
                  <td className="py-2 text-right tabular-nums"><Score value={row.monthly} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {page.specials.length > 0 && (
        <Section title="Holiday specials beaten">
          <ul className="list-disc pl-6">
            {page.specials.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </Section>
      )}
      {page.fromGame.length > 0 && (
        <Section>
          <h2 className="mb-4 text-2xl font-bold text-ink" id="from-game">From the game</h2>
          <p id="from-game-note">Sent by the player&apos;s game, not checked.</p>
          <table aria-describedby="from-game-note" aria-labelledby="from-game" className="w-full max-w-2xl table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-line-strong">
                <th className="py-2 pr-4" scope="col">Game</th>
                <th className="w-28 py-2 pr-4 text-right" scope="col">Best</th>
                <th className="w-28 py-2 text-right" scope="col">Unlocks</th>
              </tr>
            </thead>
            <tbody>
              {page.fromGame.map((row) => (
                <tr className="border-b border-line" key={row.name}>
                  <th className="break-words py-2 pr-4 font-normal" scope="row">{row.name}</th>
                  <td className="py-2 pr-4 text-right tabular-nums"><Score value={row.best} /></td>
                  <td className="py-2 text-right tabular-nums">{row.unlocks ?? "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}

export default async function WicketsPlayerPage({ params }: PageProps) {
  const name = decode((await params).player);
  const loaded = name ? await load(name) : null;
  if (!loaded) notFound();
  const shown = "page" in loaded ? loaded.page.name : loaded.hidden;
  return (
    <>
      {"page" in loaded ? (
        <PlayerPageView page={loaded.page} />
      ) : (
        <>
          <PageHeader title={loaded.hidden} />
          <Section>
            <p>This player&apos;s page is hidden.</p>
          </Section>
        </>
      )}
      <GamesProviders>
        <HidePage name={shown} />
      </GamesProviders>
      <Section>
        <p>
          <Link href="/wickets/leaderboards">Wicket&apos;s leaderboards</Link>
        </p>
      </Section>
    </>
  );
}
