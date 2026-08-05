import { PageHeader } from "@/components/PageHeader";
import { FreightFateOnlineProviders } from "@/app/freight-fate/online/providers";
import { ActivateGate } from "./activate-client";

export const metadata = {
  title: "Activate Freight Fate",
};

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  // Read server-side so the field arrives filled on first paint. A
  // useSearchParams() + post-mount useEffect would fill the field after a
  // screen reader has already passed it, silently.
  const { code } = await searchParams;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Activate Freight Fate"
        intro="Confirm the activation code Freight Fate is showing to connect this computer to your orinks.net account."
      />

      <FreightFateOnlineProviders>
        <ActivateGate initialCode={code ?? ""} />
      </FreightFateOnlineProviders>
    </div>
  );
}
