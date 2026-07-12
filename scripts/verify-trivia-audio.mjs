#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectItems } from "./generate-tts.mjs";
import { audioHash, verifyAudioManifest } from "./trivia-audio-core.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function loadJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function localPathFromWeb(webPath) {
  const relative = webPath.replace(/^\//, "").split("/").join(path.sep);
  return path.join(root, "public", relative);
}

function fileSize(webPath) {
  const filePath = localPathFromWeb(webPath);
  return existsSync(filePath) ? statSync(filePath).size : null;
}

function expectedByKind(items, config, kind) {
  return items
    .filter((item) => item.kind === kind)
    .map((item) => {
      const hash = audioHash(item, config.modelId);
      return {
        id: item.id,
        webPath: `/${path.posix.join(
          config.outputDir.replace(/^public\//, ""),
          kind,
          `${hash}.mp3`,
        )}`,
      };
    });
}

function main() {
  const config = loadJson("data/trivia/tts.config.json");
  const manifest = loadJson(config.manifestPath.replace(/^public\//, "public/"));
  const items = collectItems(config);
  let failed = false;

  for (const kind of ["barks", "questions", "story"]) {
    const report = verifyAudioManifest({
      expected: expectedByKind(items, config, kind),
      manifest: manifest[kind] ?? {},
      fileSize,
      minimumBytes: 1_024,
    });
    console.log(
      `${kind}: ${report.valid.length} valid, ${report.missing.length} missing, ` +
        `${report.stale.length} stale, ${report.tooSmall.length} too small, ` +
        `${report.unknown.length} unknown.`,
    );
    for (const issue of ["missing", "stale", "tooSmall", "unknown"]) {
      if (report[issue].length > 0) {
        failed = true;
        console.error(`${kind} ${issue}: ${report[issue].join(", ")}`);
      }
    }
  }

  if (failed) process.exitCode = 1;
}

main();
