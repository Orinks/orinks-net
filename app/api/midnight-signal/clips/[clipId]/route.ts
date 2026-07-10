import { getClipByOpaqueId } from "@/lib/midnight-signal/clips/serverCatalog";
import { openProviderStream } from "@/lib/midnight-signal/clips/providerRegistry";
import { serveMysteryClipRequest } from "@/lib/midnight-signal/clips/routeHandler";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ clipId: string }> },
) {
  const { clipId } = await context.params;
  return serveMysteryClipRequest(request, clipId, {
    lookup: getClipByOpaqueId,
    openStream: openProviderStream,
  });
}
