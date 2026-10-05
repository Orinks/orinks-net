import Link from "next/link";
import { ChannelPlayer } from "@/components/ChannelPlayer";
import { PageHeader } from "@/components/PageHeader";
import { audioPath, cast, segments, sources } from "@/lib/after-hours";
import { transcripts } from "@/lib/after-hours-transcripts";
import { link, Note } from "../_shared";

export const metadata = {
  title: "After Hours",
  description: "A whole night of television on Channel 3000, sung and spoken by computer voices.",
};

export const dynamic = "force-static";

export default function AfterHoursPage() {
  return (
    <>
      <PageHeader
        title="After Hours"
        intro={
          <>
            A whole night of television on{" "}
            <Link className={link} href="/channel-3000">
              Channel 3000
            </Link>
            , from sign-on to closedown, sung and spoken by computer voices. It starts in bright prime-time comedy
            and gets quieter, sadder and stranger as the night goes on.
          </>
        }
      />

      <section className="border-b border-line py-8">
        <h2 className="mb-4 text-2xl font-bold text-ink">Player</h2>
        <ChannelPlayer
          autoLabel="Play the next segment automatically when one ends"
          id="after-hours"
          songs={segments.map(({ slug, title }) => ({ slug, title, src: audioPath(slug) }))}
        />
      </section>

      <section className="py-8">
        <h2 className="text-2xl font-bold text-ink">Running order</h2>
        <div className="mt-6 space-y-6">
          {segments.map((segment, i) => (
            <article className="rounded-lg border border-line bg-white p-5" key={segment.slug}>
              <h3 className="scroll-mt-4 text-xl font-bold text-ink" id={segment.slug} tabIndex={-1}>
                {i + 1}. {segment.title}
              </h3>
              <p className="mt-1 text-slate-700">
                {segment.tv}, {segment.duration}.
              </p>
              <div className="mt-4 grid gap-4">
                <Note title="What happens">{segment.story}</Note>
                <Note title="The music">{segment.music}</Note>
                <Note title="Who's in it">{segment.cast}</Note>
                <Note title="Transcript">
                  <details>
                    <summary className="cursor-pointer font-semibold text-action">
                      Show the transcript of {segment.title}
                    </summary>
                    {transcripts[segment.slug].map((line, l) => (
                      <p className="mt-3 whitespace-pre-line" key={l}>
                        {line}
                      </p>
                    ))}
                  </details>
                </Note>
              </div>
              <p className="mt-4">
                <a className={link} download href={audioPath(segment.slug)}>
                  Download {segment.title} (MP3, {segment.megabytes} MB)
                </a>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-line py-8">
        <h2 className="text-2xl font-bold text-ink">Cast</h2>
        <ul className="mt-4 space-y-2">
          {cast.map((c) => (
            <li className="leading-7 text-slate-700" key={c.voice}>
              <span className="font-bold text-ink">{c.voice}:</span> {c.roles}
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-line py-8">
        <h2 className="text-2xl font-bold text-ink">Credits</h2>
        <div className="mt-2 max-w-3xl space-y-3 leading-7 text-slate-700">
          <p>
            Arranged with Claude and performed in{" "}
            <a className={link} href="https://github.com/masonasons/SingingVoiceStudio">
              Singing Voice Studio
            </a>
            . The player is{" "}
            <a className={link} href="https://ableplayer.github.io/ableplayer/">
              Able Player
            </a>
            .
          </p>
          <p>
            The borrowed tunes are all in the public domain. Where a kind of show is known by a theme still under
            copyright, such as sitcoms, cartoons and the news, the music is new and only sounds like that kind of
            show. Every word is new.
          </p>
        </div>
        <h3 className="mt-6 text-xl font-bold text-ink">Sources</h3>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          {sources.map((s) => (
            <li key={s.href}>
              <a className={link} href={s.href}>
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
