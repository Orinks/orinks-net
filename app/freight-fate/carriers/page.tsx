import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import {
  FREIGHT_FATE_CARRIERS,
  capitalized,
  freightFateCarrierHref,
  perMile,
  sharePercent,
  wholeDollars,
} from "@/lib/freight-fate-carriers";
import { CarrierBenefits } from "./carrier-benefits";

export const metadata = {
  title: "Freight Fate Carriers",
  description: "The carriers a Freight Fate company driver can work for: wage plans, dispatch, equipment, and training.",
};

export default function FreightFateCarriersPage() {
  return (
    <>
      <PageHeader
        title="Freight Fate Carriers"
        intro="Every company driver in Freight Fate works for one of these carriers, chosen when the career starts. They all supply the truck and pay its running costs. They differ in how the wage plan is weighted and in what dispatch sends you."
      />

      <Section title="Compare the carriers">
        <div aria-labelledby="carrier-table-caption" className="overflow-x-auto" role="region" tabIndex={0}>
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="mb-2 text-left font-semibold" id="carrier-table-caption">
              Wage plan and dispatch for each carrier
            </caption>
            <thead>
              <tr className="border-b border-line-strong">
                <th className="py-2 pr-4" scope="col">Carrier</th>
                <th className="py-2 pr-4" scope="col">Pay share</th>
                <th className="py-2 pr-4" scope="col">Per-mile floor</th>
                <th className="py-2 pr-4" scope="col">Stop pay</th>
                <th className="py-2 pr-4" scope="col">On-time bonus</th>
                <th className="py-2" scope="col">Dispatch</th>
              </tr>
            </thead>
            <tbody>
              {FREIGHT_FATE_CARRIERS.map((carrier) => (
                <tr className="border-b border-line align-top" key={carrier.key}>
                  <th className="py-2 pr-4 font-semibold" scope="row">
                    <Link className="text-action underline" href={freightFateCarrierHref(carrier.key)}>
                      {carrier.name}
                    </Link>
                  </th>
                  <td className="py-2 pr-4">{sharePercent(carrier.pay.payShare)}</td>
                  <td className="py-2 pr-4">{perMile(carrier.pay.minPerMile)}</td>
                  <td className="py-2 pr-4">{wholeDollars(carrier.pay.stopPay)} a load</td>
                  <td className="py-2 pr-4">{sharePercent(carrier.pay.onTimeBonusShare)}</td>
                  <td className="py-2">{capitalized(carrier.dispatch)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Each load pays the larger of the wage floor and the pay share. <a href="#pay">How company pay works</a>.
        </p>
      </Section>

      <CarrierBenefits />
    </>
  );
}
