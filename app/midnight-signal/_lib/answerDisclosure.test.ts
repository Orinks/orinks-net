import { describe, expect, test } from "vitest";
import {
  presentAnswerDisclosure,
  startContextLines,
  type ClientAnswerDisclosure,
} from "./answerDisclosure";

const officialOnly: ClientAnswerDisclosure = {
  source: {
    publisher: "Recording Academy",
    title: "Best Dance Recording Grammy Award Winners & Nominees",
    url: "https://www.grammy.com/awards/categories/best-dance-recording/",
  },
  clipAttribution: null,
};

describe("answer disclosure presentation", () => {
  test("gives the official source a descriptive standalone link name", () => {
    expect(presentAnswerDisclosure(officialOnly)).toEqual({
      links: [
        {
          kind: "official-source",
          href: officialOnly.source.url,
          label: "Best Dance Recording Grammy Award Winners & Nominees",
        },
      ],
      copyrightNotice: null,
    });
  });

  test("adds complete clip attribution and identifies a PDF license", () => {
    const result = presentAnswerDisclosure({
      ...officialOnly,
      clipAttribution: {
        creator: "Jazcardan",
        copyrightNotice: "Copyright © 2026 Jazcardan.",
        licenseTitle: "Audius Open Music License",
        licenseUrl: "https://audius.org/open-music-license.pdf",
        sourceTitle: "Jazcardan - Funky Road",
        sourceUrl: "https://audius.co/Jazcardan/jazcardan-funky-road",
      },
    });

    expect(result.links.map((link) => link.label)).toEqual([
      "Best Dance Recording Grammy Award Winners & Nominees",
      "Jazcardan - Funky Road — Jazcardan",
      "Audius Open Music License (PDF)",
    ]);
    expect(result.copyrightNotice).toBe("Copyright © 2026 Jazcardan.");
  });

  test("does not label an HTML license page as a PDF", () => {
    const result = presentAnswerDisclosure({
      ...officialOnly,
      clipAttribution: {
        creator: "Artist",
        copyrightNotice: "Copyright Artist.",
        licenseTitle: "Publisher license",
        licenseUrl: "https://example.com/license",
        sourceTitle: "Track",
        sourceUrl: "https://example.com/track",
      },
    });
    expect(result.links.at(-1)?.label).toBe("Publisher license");
  });
});

describe("retired-run start context", () => {
  test("keeps a reset explanation before ordinary broadcast context", () => {
    expect(startContextLines("The old broadcast was retired.", ["Starting round one."])).toEqual([
      "The old broadcast was retired.",
      "Starting round one.",
    ]);
    expect(startContextLines(null, ["Starting round one."])).toEqual([
      "Starting round one.",
    ]);
  });
});
