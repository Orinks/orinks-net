import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { posts } from "@/lib/site";

export const metadata = {
  title: "Blog",
};

export default function BlogPage() {
  return (
    <>
      <PageHeader title="Blog" />
      <div className="space-y-4 py-8">
        {posts.map((post) => (
          <article className="rounded-lg border border-line bg-white p-5" key={post.slug}>
            <h2 className="text-xl font-bold">
              <Link className="text-action hover:text-action-dark" href={`/blog/${post.slug}`}>
                {post.title}
              </Link>
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
                new Date(post.date),
              )}
            </p>
            <p className="mt-3 leading-7 text-slate-700">{post.excerpt}</p>
          </article>
        ))}
      </div>
    </>
  );
}
