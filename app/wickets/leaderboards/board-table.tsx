import { endsPhrase, scorePhrase, type WicketsBoard } from "@/lib/wickets-leaderboards";

function playersPhrase(board: WicketsBoard) {
  if (board.of > board.entries.length) {
    return `Top ${board.entries.length} of ${scorePhrase(board.of)} players.`;
  }
  return board.of === 1 ? "1 player." : `${board.of} players.`;
}

function Ends({ at }: { at: number }) {
  return (
    <>
      Ends <time dateTime={new Date(at).toISOString()}>{endsPhrase(at)}</time>.
    </>
  );
}

/** One board: who is on it and when it closes, then the table. An empty
 * board says so in place of the table. */
export function BoardTable({ board, caption }: { board: WicketsBoard; caption: string }) {
  if (board.entries.length === 0) {
    return (
      <p>
        No scores yet. <Ends at={board.endsAt} />
      </p>
    );
  }

  return (
    <>
      <p>
        {playersPhrase(board)} <Ends at={board.endsAt} />
      </p>
      <table className="w-full max-w-2xl table-fixed border-collapse text-left">
        <caption className="mb-2 text-left font-semibold">{caption}</caption>
        <thead>
          <tr className="border-b border-line-strong">
            <th className="w-16 py-2 pr-4" scope="col">Rank</th>
            <th className="py-2 pr-4" scope="col">Player</th>
            <th className="w-28 py-2 text-right" scope="col">Score</th>
          </tr>
        </thead>
        <tbody>
          {board.entries.map((entry) => (
            <tr className="border-b border-line" key={entry.rank}>
              <td className="py-2 pr-4">{entry.rank}</td>
              <th className="break-words py-2 pr-4 font-normal" scope="row">{entry.name}</th>
              <td className="py-2 text-right tabular-nums">{scorePhrase(entry.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
