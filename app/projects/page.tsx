import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { projectSummaries } from "@/lib/site";

export const metadata = {
  title: "Projects",
};

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        title="Projects"
        intro="Accessible software by Orinks, designed for screen reader users and the visually impaired."
      />
      <div className="grid gap-4 py-8 md:grid-cols-2">
        {projectSummaries.map((project) => (
          <article className="rounded-lg border border-line bg-white p-5" key={project.href}>
            <h2 className="text-xl font-bold">
              <Link className="text-action hover:text-action-dark" href={project.href}>
                {project.title}
              </Link>
            </h2>
            <p className="mt-2 leading-7 text-slate-700">{project.summary}</p>
            <p className="mt-4 text-sm font-semibold">
              <Link className="text-action hover:text-action-dark" href={project.downloadsHref ?? project.href}>
                Downloads and releases
              </Link>
            </p>
          </article>
        ))}
      </div>
    </>
  );
}
