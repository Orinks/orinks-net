import type { StoryBeatState } from "./gameTypes";

export function StoryBeatPanel({
  beat,
  isDaily,
}: {
  beat: StoryBeatState;
  isDaily: boolean;
}) {
  const headingId = `story-beat-${beat.id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="mt-5 rounded-lg border border-amber-700 bg-zinc-950/60 p-4"
    >
      <p className="text-sm text-zinc-400">
        {isDaily
          ? "Tonight's shared station transmission"
          : "From the station desk"}
      </p>
      <h3 className="mt-1 text-lg font-semibold text-amber-200" id={headingId}>
        {beat.title}
      </h3>
      <p className="mt-2 text-sm font-semibold text-amber-100">
        {beat.speaker}
      </p>
      <p className="mt-1 leading-7">{beat.text}</p>
    </section>
  );
}
