import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { scorePhrase } from "@/lib/wickets-leaderboards";
import type { PlayerPage } from "@/lib/wickets-profile";

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
