import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import type { ProjectPage } from "@/lib/site";

type UnavailableDownloadsProps = {
  project: ProjectPage;
};

export function UnavailableDownloads({ project }: UnavailableDownloadsProps) {
  return (
    <>
      <PageHeader title={`${project.title} Downloads`} intro={project.status} />
      <Section>
        <p>
          Public downloads are not available for {project.title} yet. The project page will link
          current builds here when there is a release ready to share.
        </p>
        <p>
          <a href={project.href}>Back to {project.title}</a>
        </p>
      </Section>
    </>
  );
}
