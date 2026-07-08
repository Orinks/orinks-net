// Clyde's bark lines and the Producer's templates. Bark text ships to the
// client (it's flavor, not spoilers); story tapes, finale, and epilogue lines
// stay server-side and arrive via Convex queries only after they're earned.
import barksJson from "@/data/trivia/barks.json";
import producerJson from "@/data/trivia/producer.json";

export interface Bark {
  id: string;
  trigger: string;
  text: string;
}

const barks: Bark[] = barksJson.lines;
const producerLines = producerJson.lines;

/**
 * Extra bark lines that arrive from the server after the finale (epilogue
 * variants). Triggers ending in "-epilogue" replace their base trigger.
 */
export function pickBark(trigger: string, epilogue: Bark[] | null): Bark | null {
  if (epilogue) {
    const candidates = epilogue.filter((line) => line.trigger === `${trigger}-epilogue`);
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }
  const candidates = barks.filter((line) => line.trigger === trigger);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function producerLine(
  trigger: string,
  values: Record<string, string | number>,
  epilogueActive = false,
): string | null {
  const line =
    (epilogueActive ? producerLines.find((l) => l.trigger === `${trigger}-epilogue`) : undefined) ??
    producerLines.find((l) => l.trigger === trigger);
  if (!line) return null;
  return line.template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
