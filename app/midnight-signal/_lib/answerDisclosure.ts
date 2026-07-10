export interface ClientMysteryClipAttribution {
  creator: string;
  copyrightNotice: string;
  licenseTitle: string;
  licenseUrl: string;
  sourceTitle: string;
  sourceUrl: string;
}

export interface ClientAnswerDisclosure {
  source: {
    publisher: string;
    title: string;
    url: string;
  };
  clipAttribution: ClientMysteryClipAttribution | null;
}

export interface DisclosureLink {
  kind: "official-source" | "clip-source" | "license";
  href: string;
  label: string;
}

export interface DisclosurePresentation {
  links: DisclosureLink[];
  copyrightNotice: string | null;
}

function isPdfUrl(url: string) {
  try {
    return new URL(url).pathname.toLocaleLowerCase("en-US").endsWith(".pdf");
  } catch {
    return false;
  }
}

/** Produces the accessibility-reviewed, descriptive link text for answer feedback. */
export function presentAnswerDisclosure(
  disclosure: ClientAnswerDisclosure,
): DisclosurePresentation {
  const links: DisclosureLink[] = [
    {
      kind: "official-source",
      href: disclosure.source.url,
      label: `Official source: ${disclosure.source.title} — ${disclosure.source.publisher}`,
    },
  ];
  const clip = disclosure.clipAttribution;
  if (clip) {
    links.push(
      {
        kind: "clip-source",
        href: clip.sourceUrl,
        label: `Mystery clip source: ${clip.sourceTitle} — ${clip.creator}`,
      },
      {
        kind: "license",
        href: clip.licenseUrl,
        label: `License: ${clip.licenseTitle}${isPdfUrl(clip.licenseUrl) ? " (PDF)" : ""}`,
      },
    );
  }
  return {
    links,
    copyrightNotice: clip?.copyrightNotice ?? null,
  };
}

/** Keeps a retired-run explanation first in both visible and announced start context. */
export function startContextLines(
  resetReason: string | null | undefined,
  lines: readonly string[],
) {
  return resetReason ? [resetReason, ...lines] : [...lines];
}
