import { ButtonLink } from "@/components/ButtonLink";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { freightFateDispatch as project } from "@/lib/site";

export const metadata = {
  title: project.title,
  description: project.summary,
};

export default function FreightFateDispatchPage() {
  return (
    <>
      <PageHeader title={project.title} intro={project.tagline} />
      <Section>
        <p>
          Freight Fate: Dispatch is an audio management game for blind and visually impaired
          players, for Windows, macOS, and Linux. You start with a new authority, a few trucks, a
          few drivers, and a load board that fills every morning. Decide who hauls what, keep
          your customers, keep your drivers, and keep the carrier out of the red.
        </p>
        <p>
          Time only moves when you act, so you can think about a decision for as long as you
          like.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href={project.downloadsHref!}>Download Freight Fate: Dispatch</ButtonLink>
        </div>
      </Section>
      <Section title="Cover the freight">
        <p>
          Your contract customers send tomorrow&apos;s loads the day before, and they remember
          every one you turn down or deliver late. Serve them well and they send more freight at
          better rates. Let them down and they cut you back, then leave.
        </p>
        <p>
          Brokers fill the rest of the board with spot loads. Push a broker for a better rate
          and you might get it, or you might watch the load go to another carrier.
        </p>
      </Section>
      <Section title="Know your drivers">
        <p>
          No two drivers are alike, and you only find out how by working with them. One runs
          fast and draws tickets. Another is careful but goes quiet on the road. Some won&apos;t
          go to the northeast or pull a reefer.
        </p>
        <p>
          Give them fair miles and get them home, and they stay. Run them ragged or leave them
          sitting, and they hand in two weeks&apos; notice.
        </p>
      </Section>
      <Section title="Stay legal">
        <p>
          The hours of service are the real ones: 11 hours of driving, a 14-hour day, 70 hours
          in 8 days. When a driver can&apos;t make an appointment on legal hours, you can send
          them anyway, and a scale may find that log.
        </p>
        <p>
          Inspections, citations, and suspended licenses all count against the carrier&apos;s
          safety score. Let it climb too far and the auditors arrive.
        </p>
      </Section>
      <Section title="Answer the phone">
        <p>
          The morning&apos;s plan rarely lasts the day. A truck breaks down. A shipper holds a
          driver at the dock for hours. Someone calls in sick, and a broker rings with a hot
          load that pays well if you can cover it now. Every call is a decision, and every
          answer costs something.
        </p>
      </Section>
      <Section title="Make the money work">
        <p>
          A delivered load doesn&apos;t pay for weeks. Fuel, driver pay, truck notes, insurance,
          and rent don&apos;t wait. Factor your invoices and get paid tomorrow for a cut, or hold
          out for the full amount and lean on the line of credit. Stay over the line for a month
          and the bank closes the carrier.
        </p>
      </Section>
      <Section title="Grow the carrier">
        <p>
          Each Sunday closes with the week&apos;s scorecard. As your reputation builds, bigger
          shippers take your sales calls, a loyal customer offers a dedicated account, and a
          second terminal opens in another city.
        </p>
        <p>
          Drivers from your <a href="/freight-fate">Freight Fate</a> careers can join the
          roster.
        </p>
      </Section>
      <Section title="Links">
        <ul>
          {project.links
            .filter((link) => link.href.startsWith("https://"))
            .map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
        </ul>
      </Section>
    </>
  );
}
