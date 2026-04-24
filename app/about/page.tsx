import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { socialLinks } from "@/lib/site";

export const metadata = {
  title: "About",
};

export default function AboutPage() {
  return (
    <>
      <PageHeader title="About" />
      <Section>
        <p>
          Welcome to the digital domain of Joshua Tubbs. Joshua Tubbs is a{" "}
          <a href="https://youtube.com/orinks">YouTuber</a>,{" "}
          <a href="https://twitch.tv/orinks1">Twitch streamer</a>, and is even known to{" "}
          <a href="https://storiesonline.net/a/orinks">write a thing or two</a>.
        </p>
        <p>You can also find him on these platforms:</p>
        <ul>
          {socialLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
