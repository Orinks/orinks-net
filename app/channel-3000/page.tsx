import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { segments } from "@/lib/after-hours";
import { songs } from "@/lib/grimatonics";

export const metadata = {
  title: "Channel 3000",
  description: "A television station where every voice is a computer's.",
};

export const dynamic = "force-static";

function minutes(durations: string[]) {
  const seconds = durations.reduce((sum, d) => {
    const [m, s] = d.split(":").map(Number);
    return sum + m * 60 + s;
  }, 0);
  return Math.round(seconds / 60);
}

export default function Channel3000Page() {
  return (
    <>
      <PageHeader
        title="Channel 3000"
        intro="A television station where every voice is a computer's: VocalWriter's singers, DECtalk, the SSI-263 chip, and Microsoft Sam, Mike and Mary."
      />

      <Section title="After Hours">
        <p>
          A whole night of television, from sign-on to closedown: a sitcom, cartoons, a documentary, a love story,
          the news, a ghost story and a space drama. {segments.length} segments,{" "}
          {minutes(segments.map((s) => s.duration))} minutes.
        </p>
        <p>
          <Link href="/channel-3000/after-hours">Listen to After Hours</Link>
        </p>
      </Section>

      <Section title="Grimatonics">
        <p>
          Dark nursery rhymes, sung a cappella, each carried from its own time into ours. {songs.length} songs,{" "}
          {minutes(songs.map((s) => s.duration))} minutes.
        </p>
        <p>
          <Link href="/channel-3000/grimatonics">Listen to Grimatonics</Link>
        </p>
      </Section>
    </>
  );
}
