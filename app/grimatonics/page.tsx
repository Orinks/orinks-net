import { statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { GrimatonicsPlayer } from "@/components/GrimatonicsPlayer";
import { PageHeader } from "@/components/PageHeader";
import { audioPath, cast, songs, sources } from "@/lib/grimatonics";
import { lyrics } from "@/lib/grimatonics-lyrics";

export const metadata = {
  title: "Grimatonics",
  description: "Dark nursery rhymes, sung a cappella by computer voices.",
};

export const dynamic = "force-static";

const link = "font-semibold text-action underline hover:text-action-dark";

function megabytes(slug: string) {
  return (statSync(join(process.cwd(), "public", audioPath(slug))).size / 1e6).toFixed(1);
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="font-bold text-ink">{title}</h4>
      <div className="mt-1 leading-7 text-slate-700">{children}</div>
    </div>
  );
}

export default function GrimatonicsPage() {
  return (
    <>
      <PageHeader
        title="Grimatonics"
        intro="Dark nursery rhymes, sung a cappella by computer voices. Each song starts in the rhyme's own time and walks it into ours. They run from the lightest to the darkest."
      />

      <section className="border-b border-line py-8">
        <h2 className="mb-4 text-2xl font-bold text-ink">Player</h2>
        <GrimatonicsPlayer songs={songs.map(({ slug, title }) => ({ slug, title, src: audioPath(slug) }))} />
      </section>

      <section className="py-8">
        <h2 className="text-2xl font-bold text-ink">Songs</h2>
        <p className="mt-2 max-w-3xl leading-7 text-slate-700">
          Many famous &ldquo;dark origins&rdquo; were made up long after the rhymes. Each song&rsquo;s notes keep
          what is on record apart from what is only folklore.
        </p>
        <div className="mt-6 space-y-6">
          {songs.map((song, i) => (
            <article className="rounded-lg border border-line bg-white p-5" key={song.slug}>
              <h3 className="scroll-mt-4 text-xl font-bold text-ink" id={song.slug} tabIndex={-1}>
                {i + 1}. {song.title}
              </h3>
              <p className="mt-1 text-slate-700">
                {song.tagline} From {song.origin}, {song.duration}.
              </p>
              <div className="mt-4 grid gap-4">
                <Note title="Tune and key">{song.tune}</Note>
                <Note title="On record">{song.onRecord}</Note>
                <Note title="Folklore">{song.folklore}</Note>
                <Note title="Today">{song.modern}</Note>
                <Note title="Trivia">
                  <ul className="list-disc space-y-1 pl-6">
                    {song.trivia.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </Note>
                <Note title="Who sings">{song.singers}</Note>
                <Note title="Lyrics">
                  <details>
                    <summary className="cursor-pointer font-semibold text-action">
                      Show the words to {song.title}
                    </summary>
                    {lyrics[song.slug].map((verse, v) =>
                      typeof verse === "string" ? (
                        <p className="mt-3 whitespace-pre-line" key={v}>
                          {verse}
                        </p>
                      ) : (
                        <p className="mt-3 whitespace-pre-line" key={v} lang={verse.lang}>
                          {verse.text}
                        </p>
                      ),
                    )}
                  </details>
                </Note>
              </div>
              <p className="mt-4">
                <a className={link} download href={audioPath(song.slug)}>
                  Download {song.title} (MP3, {megabytes(song.slug)} MB)
                </a>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-line py-8">
        <h2 className="text-2xl font-bold text-ink">Cast</h2>
        <p className="mt-2 max-w-3xl leading-7 text-slate-700">
          Every part is a singer. Instruments only open and close a few songs.
        </p>
        <ul className="mt-4 space-y-2">
          {cast.map((c) => (
            <li className="leading-7 text-slate-700" key={c.singer}>
              <span className="font-bold text-ink">{c.singer}:</span> {c.roles}
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-line py-8">
        <h2 className="text-2xl font-bold text-ink">Credits</h2>
        <div className="mt-2 max-w-3xl space-y-3 leading-7 text-slate-700">
          <p>
            Grimatonics borrows its idea, and the way this page works, from{" "}
            <a className={link} href="https://l-works.net/robatonics/">
              Robatonics at L-Works
            </a>
            , a group of robot singers who bring you songbook standards. Go and listen to them.
          </p>
          <p>
            Arranged with Claude and sung by{" "}
            <a className={link} href="https://github.com/masonasons/vocalwriter">
              VocalWriter Studio
            </a>
            . The player is{" "}
            <a className={link} href="https://ableplayer.github.io/ableplayer/">
              Able Player
            </a>
            .
          </p>
          <p>
            The traditional tunes are in the public domain. Wee Willie Winkie, The Old Woman Who Lived in a Shoe
            and Who Killed Cock Robin are set to new tunes.
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
