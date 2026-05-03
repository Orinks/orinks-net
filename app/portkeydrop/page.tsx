import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "PortkeyDrop",
};

export default function PortkeyDropPage() {
  return (
    <>
      <PageHeader
        title="PortkeyDrop"
        intro="An accessible file transfer application for Windows and macOS."
      />
      <Section>
        <p>
          PortkeyDrop is built for sending and receiving files with full screen reader support,
          keyboard-friendly panes, transfer progress, and accessible activity logging.
        </p>
      </Section>
      <ReleaseDownloads productName="PortkeyDrop" repo="PortkeyDrop" />
      <Section title="Links">
        <ul>
          <li>
            <a href="https://github.com/Orinks/PortkeyDrop">GitHub repository</a>
          </li>
          <li>
            <a href="https://github.com/Orinks/PortkeyDrop/issues">Report an issue</a>
          </li>
        </ul>
      </Section>
    </>
  );
}
