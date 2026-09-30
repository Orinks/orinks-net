import type { ReactNode } from "react";
import {
  FREIGHT_FATE_BUY_IN_LEVEL,
  FREIGHT_FATE_COMPANY_PAY,
  FREIGHT_FATE_COURSE_ONLY_TRAINING,
  FREIGHT_FATE_FLEET_TIERS,
  FREIGHT_FATE_OWNER_OPERATOR_START_CARRIERS,
  FREIGHT_FATE_SPONSORED_TRAINING,
  capitalized,
  listInWords,
  sharePercent,
} from "@/lib/freight-fate-carriers";

// The fragment sits on the heading, which takes focus, so a link from a
// profile to #equipment lands a screen reader on the heading it names.
function AnchoredSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="py-8">
      <h2 className="mb-4 scroll-mt-6 text-2xl font-bold text-ink" id={id} tabIndex={-1}>{title}</h2>
      <div className="prose prose-slate max-w-none prose-a:text-action prose-a:font-semibold prose-li:my-1">
        {children}
      </div>
    </section>
  );
}

function plural(tier: string, count: number) {
  return count > 1 ? `${tier}s` : tier;
}

/** What every carrier gives its company drivers, the same on every carrier page. */
export function CarrierBenefits() {
  return (
    <>
      <AnchoredSection id="pay" title="How company pay works">
        <p>
          Each load pays the larger of two amounts: the wage floor, which is the stop pay plus the per-mile floor for
          every mile driven, or the pay share, a percentage of what the load itself pays. Delivering on time adds the
          on-time bonus on top.
        </p>
        <p>
          Dispatch trust pays as well. A reputation above where you started earns up to{" "}
          {sharePercent(FREIGHT_FATE_COMPANY_PAY.reputationBonusMaxShare)} more of the load&apos;s pay, the full
          amount at a reputation of 100.
        </p>
        <p>
          When dispatch sends you empty to another city, that reposition pays{" "}
          {sharePercent(FREIGHT_FATE_COMPANY_PAY.assignedRepositionPayFraction)} of your per-mile floor. Bobtailing
          to a nearby city on your own pays nothing.
        </p>
      </AnchoredSection>

      <AnchoredSection id="covered" title="What the carrier covers">
        <p>
          The carrier supplies the tractor, fuel, repairs, trailer, authority, and insurance. Your settlements are your
          wages and bonuses.
        </p>
      </AnchoredSection>

      <AnchoredSection id="equipment" title="Equipment as you level">
        <p>You do not choose a tractor. The carrier assigns one from the fleet tier your level has earned:</p>
        <ul>
          {FREIGHT_FATE_FLEET_TIERS.map((tier) => (
            <li key={tier.label}>Level {tier.minLevel} and up: {tier.label}</li>
          ))}
        </ul>
        <p>
          A poor driving record, a license problem, or money you owe can hold your equipment back below the tier your
          level earns until it clears.
        </p>
      </AnchoredSection>

      <AnchoredSection id="training" title="Carrier-sponsored training">
        <p>Your carrier pays for these courses when you reach the level:</p>
        <ul>
          {FREIGHT_FATE_SPONSORED_TRAINING.map((group) => (
            <li key={`${group.level}-${group.tier}`}>
              Level {group.level}: {listInWords(group.labels)} {plural(group.tier, group.labels.length)}
            </li>
          ))}
        </ul>
        <p>You can pay for one of these courses yourself to hold it sooner.</p>
        {FREIGHT_FATE_COURSE_ONLY_TRAINING.length > 0 ? (
          <p>
            {capitalized(listInWords(FREIGHT_FATE_COURSE_ONLY_TRAINING))} are never sponsored by level; only their own
            course earns them.
          </p>
        ) : null}
      </AnchoredSection>

      <AnchoredSection id="owner-operator" title="Becoming an owner-operator">
        <p>
          From level {FREIGHT_FATE_BUY_IN_LEVEL} you can buy in as an owner-operator, leased on to your carrier, or stay
          a company driver by choice. An owner-operator owns the truck and pays its running costs.
        </p>
        {FREIGHT_FATE_OWNER_OPERATOR_START_CARRIERS.length > 0 ? (
          <p>
            A career can also start as an owner-operator from day one, leased on to{" "}
            {listInWords(FREIGHT_FATE_OWNER_OPERATOR_START_CARRIERS)}.
          </p>
        ) : null}
      </AnchoredSection>
    </>
  );
}
