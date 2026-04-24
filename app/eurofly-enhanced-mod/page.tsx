import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Eurofly Enhanced Mod",
};

export default function EuroflyPage() {
  return (
    <>
      <PageHeader title="Eurofly Enhanced Mod" />
      <Section>
        <p>
          Are you tired of some of the audio and string choices that were made in the base download
          of <a href="https://www.eurofly.stefankiss.sk">Eurofly</a>, the number one arcade flight
          simulator for the blind? You are not alone. Eurofly Enhanced Mod changes a number of the
          default audio and strings to be more realistic.
        </p>
        <h2>Feature highlights</h2>
        <ul>
          <li>Changed the menu files to use a different voice.</li>
          <li>Removed the reverser tone.</li>
          <li>Changed a number of alerts to be less verbose.</li>
          <li>Changed aircraft-related strings to better reflect real world aircraft systems.</li>
        </ul>
        <h2>Changelog</h2>
        <p>
          In this recovered backup, the old tasks folder used for translation was removed. Most of
          those tasks have been added to the English version of the game. A number of tasks in the
          main campaign still contain typos, but the mod is available again for those who missed the
          original release.
        </p>
        <h2>Download</h2>
        <p>
          <ButtonLink href="https://orinks.net/wp-content/uploads/2021/10/Eurofly-Enhanced-1.4.zip">
            Download Eurofly Enhanced Mod V1.4
          </ButtonLink>
        </p>
      </Section>
    </>
  );
}
