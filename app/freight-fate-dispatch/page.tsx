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
      <PageHeader title={project.title} />
      <Section>
        <p>
          Built from the ground up for blind and visually impaired players, Freight Fate:
          Dispatch puts you in the hot seat of a struggling trucking carrier where every ringing
          phone, unexpected crisis, and missed delivery can put you out of business.
        </p>
        <p>
          Driven by sharp text, atmospheric music, and the stark ring of a desk phone signaling
          a new event, there are no arcade timers or frantic clicking here. Time only moves when
          you act, leaving you alone with your coffee, your logs, and your decisions.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href={project.downloadsHref!}>Download Freight Fate: Dispatch</ButtonLink>
        </div>
        <p className="mt-3">Windows, macOS, Linux</p>
      </Section>
      <Section title="Cover the Freight">
        <p>
          Your contract customers send tomorrow’s loads the day before, and they have long,
          unforgiving memories.
        </p>
        <ul>
          <li>
            <strong>Keep your commitments:</strong> Deliver on time and they’ll throw you steady
            freight at decent rates. Turn them down or miss a window, and they’ll quietly claw
            back their volume before pulling their account entirely.
          </li>
          <li>
            <strong>Play the spot market:</strong> Brokers fill the rest of the board with cheap
            spot loads and attitude. Push them for a better rate and you might pad your margins,
            or watch the load vanish to a carrier desperate enough to haul it for pennies.
          </li>
        </ul>
      </Section>
      <Section title="Know Your Drivers">
        <p>
          No two drivers are alike, and you only learn their faults when they’re stranded three
          states away. One runs hot, logs 80 miles an hour, and collects speeding tickets like
          souvenirs. Another is safe as a church but goes radio-silent for twelve hours straight.
          Some refuse to touch the Northeast; others won’t pull a reefer unit. Give them fair
          miles and get them home to their families, and they stay loyal. Run them ragged or
          leave them sitting unpaid, and you’ll be staring at a two-week notice by Sunday night.
        </p>
      </Section>
      <Section title="Stay Legal (Or Gamble at the Scales)">
        <p>
          The Hours of Service regulations are the real ones: 11 hours of driving, a 14-hour
          workday, and 70 hours in 8 days. When a driver is out of hours and a tight delivery is
          on the line, the choice is yours: shut them down and take the hit, or tell them to run
          it anyway and pray they bypass the weigh station. Inspections, logbook citations, and
          suspended licenses tank your safety score. Let it climb too high, and the DOT auditors
          show up with clipboards and bad news.
        </p>
      </Section>
      <Section title="Answer the Phone">
        <p>
          The morning dispatch plan is dead by noon. The desk phone rings, bringing a fresh wave
          of operational chaos: a truck has broken down in a blizzard on I-80, a shipper is
          holding your driver at the dock for six hours of unpaid detention, or a broker is
          hitting your line with a hot, high-paying load that needs a truck now. Every
          interruption demands a choice, and every answer carries a cost.
        </p>
      </Section>
      <Section title="Make the Money Work">
        <p>
          Freight doesn’t pay the day it drops. Customers take thirty days to settle an invoice.
          But diesel, driver pay, monthly truck notes, insurance, and terminal rent don’t wait.
        </p>
        <ul>
          <li>
            Factor your invoices to get cash tomorrow in exchange for a punishing percentage cut.
          </li>
          <li>
            Hold out for the full payout and lean on your bank line of credit to survive the
            gap. Just don’t stay maxed out for a full month, or the bank will padlock the doors
            and repossess your authority.
          </li>
        </ul>
      </Section>
      <Section title="Grow the Carrier">
        <p>
          Every Sunday closes with your weekly scorecard in red or black. As your reputation
          grinds upward, bigger shippers start taking your sales calls, loyal customers offer
          lucrative dedicated lanes, and you can finally afford to open a second terminal in a
          new city.
        </p>
        <p>
          <strong>Bring Your Crew:</strong> Already ran routes in{" "}
          <a href="/freight-fate">Freight Fate</a>? Import your veteran drivers straight from
          your existing career files to anchor your new dispatch roster.
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
