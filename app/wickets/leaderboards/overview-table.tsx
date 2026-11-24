import { endsPhrase, scorePhrase } from "@/lib/wickets-leaderboards";
import {
  FIRST_PLACE_POINTS,
  TOP,
  ordinal,
  type Overview,
} from "@/lib/wickets-leaderboards/overview";

/** Every game's board for one period, as one table of players by points,
 * named by the heading `labelledBy`. `names` gives each game's name by id. */
export function OverviewTable({
  overview,
  endsAt,
  names,
  labelledBy,
}: {
  overview: Overview;
  endsAt: number;
  names: Record<string, string>;
  labelledBy: string;
}) {
  const ends = (
    <>
      Ends{" "}
      <time dateTime={new Date(endsAt).toISOString()}>
        {endsPhrase(endsAt)}
      </time>
      .
    </>
  );
  if (overview.entries.length === 0) {
    return <p>No scores yet. {ends}</p>;
  }
  const of = overview.entries.length;
  const shown = overview.entries.slice(0, TOP);
  const players =
    of > shown.length
      ? `Top ${shown.length} of ${scorePhrase(of)} players`
      : of === 1
        ? "1 player"
        : `${of} players`;
  return (
    <>
      <p>
        {players}. {ends}
      </p>
      <p>
        Points for each game&apos;s place: {FIRST_PLACE_POINTS} for first, down
        to 1 for tenth.
      </p>
      <table
        aria-labelledby={labelledBy}
        className="w-full max-w-3xl table-fixed border-collapse text-left"
      >
        <thead>
          <tr className="border-b border-line-strong">
            <th className="w-16 py-2 pr-4" scope="col">
              Rank
            </th>
            <th className="py-2 pr-4" scope="col">
              Player
            </th>
            <th className="w-20 py-2 pr-4 text-right" scope="col">
              Points
            </th>
            <th className="py-2" scope="col">
              Places
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((entry) => (
            <tr className="border-b border-line" key={entry.name}>
              <td className="py-2 pr-4">{entry.rank}</td>
              <th className="break-words py-2 pr-4 font-normal" scope="row">
                {entry.name}
              </th>
              <td className="py-2 pr-4 text-right tabular-nums">
                {entry.points}
              </td>
              <td className="break-words py-2">
                {entry.placings
                  .map(
                    (p) => `${ordinal(p.rank)} in ${names[p.game] ?? p.game}`,
                  )
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
