import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import type { ProjectPage } from "@/lib/site";

type ProjectLandingProps = {
  project: ProjectPage;
};

export function ProjectLanding({ project }: ProjectLandingProps) {
  return (
    <>
      <PageHeader title={project.title} intro={project.tagline} />
      <Section>
        <p>{project.summary}</p>
        <p>{project.audience}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {project.downloadsHref ? <ButtonLink href={project.downloadsHref}>Downloads</ButtonLink> : null}
          {project.manualHref ? (
            <ButtonLink href={project.manualHref} variant="secondary">
              User manual
            </ButtonLink>
          ) : null}
        </div>
      </Section>

      <Section title="Highlights">
        <ul>
          {project.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </Section>

      <Section title="Status">
        <p>{project.status}</p>
      </Section>

      <Section title="Links">
        <ul>
          {project.links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
