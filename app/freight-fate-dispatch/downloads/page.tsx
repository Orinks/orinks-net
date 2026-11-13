import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

// Rebuilt at most every five minutes rather than on every visit. Dispatch's
// release workflow does not announce builds to the site, so this interval is
// what brings a new release onto the page.
export const revalidate = 300;

export const metadata = {
  title: "Freight Fate: Dispatch Downloads",
  description:
    "Download Freight Fate: Dispatch for Windows, macOS on Apple Silicon, or Linux, with instructions for keeping your careers when updating.",
};

export default function FreightFateDispatchDownloadsPage() {
  return (
    <>
      <PageHeader
        title="Freight Fate: Dispatch Downloads"
        intro="Releases of Freight Fate: Dispatch for Windows, macOS and Linux."
      />
      <Section>
        <p>Download the package for your system and unpack it. No installer is required.</p>
        <ul>
          <li>
            <strong>Windows:</strong> Unzip the download and run FreightFateDispatch.exe.
          </li>
          <li>
            <strong>macOS:</strong> The build runs on Apple Silicon Macs. Unzip the download and
            open FreightFateDispatch.app. The app is not notarized yet, so the first time, open
            its shortcut menu with Control-click, or VO-Shift-M in VoiceOver, and choose Open.
          </li>
          <li>
            <strong>Linux:</strong> The build is for x64. Unpack the tarball and run the
            FreightFateDispatch program inside.
          </li>
        </ul>
      </Section>
      <Section title="Updating and keeping your careers">
        <p>
          On Windows and Linux, careers and settings stay in the <code>saves</code> folder inside
          the <code>FreightFateDispatch</code> folder. Unpack the new version over the old copy,
          or move the old <code>saves</code> folder into the new copy before starting it.
        </p>
        <p>
          On macOS, replace the app. Your careers and settings stay in{" "}
          <code>~/Library/Application Support/FreightFateDispatch</code>.
        </p>
        <p>
          <a href="/freight-fate-dispatch">About Freight Fate: Dispatch</a>
        </p>
      </Section>
      <ReleaseDownloads
        productName="Freight Fate: Dispatch"
        repo="freight-fate-dispatch"
        prereleaseLabel="beta releases"
        buildNotifications={false}
      />
    </>
  );
}
