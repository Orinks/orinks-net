import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { gameSummaries } from "@/lib/site";

export const metadata = {
  title: "Games",
};

export default function GamesPage() {
  return (
    <>
      <PageHeader
        title="Games"
        intro="Games built around spatial sound, keyboard play, and screen reader-friendly status updates."
      />
      <div className="grid gap-4 py-8 md:grid-cols-2">
        {gameSummaries.map((game) => (
          <article className="rounded-lg border border-line bg-white p-5" key={game.href}>
            <h2 className="text-xl font-bold text-ink">{game.title}</h2>
            <p className="mt-2 leading-7 text-slate-700">{game.summary}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href={game.primaryHref}>
                {game.primaryLabel}: {game.title}
              </ButtonLink>
              <ButtonLink href={game.href} variant="secondary">
                View {game.title} details
              </ButtonLink>
              {game.links.map((link) => (
                <ButtonLink href={link.href} key={link.href} variant="secondary">
                  {game.title}: {link.label}
                </ButtonLink>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
