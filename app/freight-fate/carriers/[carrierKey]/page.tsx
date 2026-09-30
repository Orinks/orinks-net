import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FreightFateHashFocus } from "@/components/FreightFateHashFocus";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import {
  FREIGHT_FATE_CARRIERS,
  capitalized,
  freightFateCarrier,
  listInWords,
  perMile,
  sharePercent,
  wholeDollars,
} from "@/lib/freight-fate-carriers";
import { CarrierBenefits } from "../carrier-benefits";

type CarrierPageProps = { params: Promise<{ carrierKey: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return FREIGHT_FATE_CARRIERS.map((carrier) => ({ carrierKey: carrier.key }));
}

export async function generateMetadata({ params }: CarrierPageProps): Promise<Metadata> {
  const carrier = freightFateCarrier((await params).carrierKey);
  return carrier
    ? { title: `${carrier.name} - Freight Fate Carrier`, description: carrier.description }
    : { title: "Freight Fate Carrier Not Found" };
}

export default async function FreightFateCarrierPage({ params }: CarrierPageProps) {
  const carrier = freightFateCarrier((await params).carrierKey);
  if (!carrier) notFound();
  const facts: Array<[string, string]> = [
    ["Pay share", `${sharePercent(carrier.pay.payShare)} of what each load pays`],
    ["Per-mile floor", perMile(carrier.pay.minPerMile)],
    ["Stop pay", `${wholeDollars(carrier.pay.stopPay)} a load`],
    ["On-time bonus", `${sharePercent(carrier.pay.onTimeBonusShare)} of what the load pays`],
  ];
  return (
    <>
      <FreightFateHashFocus />
      <PageHeader title={carrier.name} intro={carrier.description} />
      <p className="mt-6">
        <Link className="font-semibold text-action underline" href="/freight-fate/carriers">
          Compare all Freight Fate carriers
        </Link>
      </p>

      <Section title="Wage plan">
        <p>
          Each load pays the larger of the wage floor and the pay share. <a href="#pay">How company pay works</a>.
        </p>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div className="min-w-0" key={label}>
              <dt className="font-semibold">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Dispatch">
        <p>{capitalized(carrier.dispatch)}.</p>
        {carrier.favoredFreight.length > 0 ? (
          <p>The freight board favors {listInWords(carrier.favoredFreight)}.</p>
        ) : null}
        <p>
          The home terminal menu starts on {carrier.suggestedHomeTerminal} for this carrier, and you can pick any city.
        </p>
      </Section>

      <CarrierBenefits />
    </>
  );
}
