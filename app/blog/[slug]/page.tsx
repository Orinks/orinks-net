import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { posts } from "@/lib/site";

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = posts.find((item) => item.slug === slug);

  return {
    title: post?.title ?? "Post",
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = posts.find((item) => item.slug === slug);

  if (!post) {
    notFound();
  }

  return (
    <>
      <PageHeader title={post.title} />
      <p className="mt-4 text-sm text-slate-600">
        {new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
          new Date(post.date),
        )}
      </p>
      <Section>
        {post.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </Section>
    </>
  );
}
