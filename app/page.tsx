import Link from "next/link";
import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { RecentUpdates } from "@/components/RecentUpdates";
import { Section } from "@/components/Section";
import { projectSummaries, posts } from "@/lib/site";

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Home"
        intro="Welcome to the digital domain of Joshua Tubbs, a YouTuber, Twitch streamer, flight simulation enthusiast, and accessibility evangelist."
      />

      <Section>
        <p>
          Joshua Tubbs is a{" "}
          <a href="https://youtube.com/orinks">YouTuber</a>,{" "}
          <a href="https://twitch.tv/orinks1">Twitch streamer</a>, and is even known to{" "}
          <a href="https://storiesonline.net/a/orinks">write a thing or two</a>.
        </p>
        <p>
          Visit the <Link href="/blog">blog</Link> for the latest updates, or visit the{" "}
          <Link href="/about">about page</Link> to find social links.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/projects">Browse projects</ButtonLink>
          <ButtonLink href="/audio-games" variant="secondary">
            Audio games
          </ButtonLink>
          <ButtonLink href="/blog" variant="secondary">
            Read the blog
          </ButtonLink>
        </div>
      </Section>

      <RecentUpdates />

      <section className="py-8" aria-labelledby="featured-projects">
        <h2 className="mb-4 text-2xl font-bold text-ink" id="featured-projects">
          Featured projects
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {projectSummaries.slice(0, 4).map((project) => (
            <article className="rounded-lg border border-line bg-white p-5" key={project.href}>
              <h3 className="text-xl font-bold">
                <Link className="text-action hover:text-action-dark" href={project.href}>
                  {project.title}
                </Link>
              </h3>
              <p className="mt-2 leading-7 text-slate-700">{project.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="py-8" aria-labelledby="recent-posts">
        <h2 className="mb-4 text-2xl font-bold text-ink" id="recent-posts">
          Recent posts
        </h2>
        {posts.map((post) => (
          <article className="rounded-lg border border-line bg-white p-5" key={post.slug}>
            <h3 className="text-xl font-bold">
              <Link className="text-action hover:text-action-dark" href={`/blog/${post.slug}`}>
                {post.title}
              </Link>
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
                new Date(post.date),
              )}
            </p>
            <p className="mt-3 leading-7 text-slate-700">{post.excerpt}</p>
          </article>
        ))}
      </section>
    </>
  );
}
