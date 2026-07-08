import { PageHeader } from "@/components/PageHeader";
import { ReleaseDownloads } from "@/components/ReleaseDownloads";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Freight Fate Downloads",
};

export default function FreightFateDownloadsPage() {
  return (
    <>
      <PageHeader
        title="Freight Fate Downloads"
        intro="Stable releases and preview snapshots for Freight Fate."
      />
      <Section>
        <p>
          Use the stable release for everyday hauling, or choose a preview snapshot when you want
          the newest features and fixes before they reach a stable release. Both are portable
          builds for Windows, macOS, and Linux: unzip and run, no installer required.
        </p>
        <p>
          <a href="/freight-fate">Back to Freight Fate</a>
        </p>
      </Section>
      <ReleaseDownloads
        productName="Freight Fate"
        repo="Freight-Fate"
        prereleaseLabel="preview snapshots"
      />
      <Section title="Playing with JAWS">
        <p>
          JAWS normally keeps the arrow keys for its own reading commands, so the truck does not
          respond when you try to drive. A small keymap file fixes this: it tells JAWS to pass the
          driving keys, the arrows, NumPad plus and minus, and Backspace, straight through to the
          game whenever the game window is focused. NVDA and Narrator do not need this file.
        </p>
        <p>
          <a href="/downloads/FreightFate.jkm" download>
            Download the JAWS keymap file, FreightFate.jkm
          </a>
        </p>
        <p>To install it:</p>
        <ol>
          <li>Download FreightFate.jkm with the link above.</li>
          <li>
            Open the JAWS window by pressing Insert plus J, or CapsLock plus J on the laptop
            keyboard layout.
          </li>
          <li>
            Open the Utilities menu, choose Explore Utilities Folder, then choose Explore My
            Settings. A folder opens in File Explorer.
          </li>
          <li>Copy FreightFate.jkm from your Downloads folder into that settings folder.</li>
          <li>Start Freight Fate. The driving keys now reach the game.</li>
        </ol>
      </Section>
    </>
  );
}
