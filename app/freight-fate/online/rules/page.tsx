import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata = {
  title: "Freight Fate Online Rules",
};

export default function FreightFateOnlineRulesPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Freight Fate Online Rules" />

      <Section title="Naming rules">
        <ul>
          <li>No slurs or hate speech.</li>
          <li>No names of hate figures, and no hate symbols or their number codes.</li>
          <li>No profanity or sexual content.</li>
          <li>No impersonating other people.</li>
          <li>No harassment or targeting of other players.</li>
          <li>Names must include at least three letters.</li>
        </ul>
        <p>
          The rules cover the plain meaning of a name, not just its exact spelling — swapping in
          numbers or symbols to sneak a banned word past the filter still breaks the rules.
        </p>
      </Section>

      <Section title="What happens if a name breaks the rules">
        <p>
          Names are screened when you save them, so a name that breaks these rules is rejected on
          the spot and never appears publicly. We may also rename or disable any driver whose name
          we consider abusive, at our discretion and without notice. If a moderator resets your
          name, the setup page will ask you to choose a new one before your driver appears publicly
          again.
        </p>
      </Section>
    </div>
  );
}
