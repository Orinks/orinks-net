import { ContactForm } from "@/components/ContactForm";
import { PageHeader } from "@/components/PageHeader";

export const metadata = {
  title: "Contact",
};

export default function ContactPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <>
      <PageHeader title="Contact" />
      {/* Not wrapped in <Section>: its `prose` styles would fight the form's
          own spacing and label typography. */}
      <section className="py-8">
        {siteKey ? (
          <ContactForm siteKey={siteKey} />
        ) : (
          <p className="max-w-2xl text-slate-700">
            The contact form is not switched on yet. In the meantime, email{" "}
            <a className="font-semibold text-action underline" href="mailto:orin8722@gmail.com">
              orin8722@gmail.com
            </a>
            .
          </p>
        )}
      </section>
    </>
  );
}
