// Bundles hearken-rules/<game>/*.wasm into the Cloudflare Worker. A Worker
// has no disk to read them from and may not compile WebAssembly from bytes,
// so each module is imported at build time, already compiled, with its
// build ID (the SHA-256 of its bytes) worked out here.
// lib/games/service.ts reads them as "virtual:hearken-rules".
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ID = "virtual:hearken-rules";

export function hearkenRules(root = process.cwd()) {
  const dir = resolve(root, "hearken-rules");
  return {
    name: "hearken-rules",
    resolveId(source) {
      return source === ID ? `\0${ID}` : null;
    },
    load(id) {
      if (id !== `\0${ID}`) return null;
      const imports = [];
      const games = {};
      const folders = (() => {
        try {
          return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
        } catch {
          return [];
        }
      })();
      for (const game of folders) {
        for (const file of readdirSync(join(dir, game)).filter((n) => n.endsWith(".wasm")).sort()) {
          const path = join(dir, game, file);
          const build = createHash("sha256").update(readFileSync(path)).digest("hex");
          const name = `m${imports.length}`;
          imports.push(`import ${name} from ${JSON.stringify(`${path}?module`)};`);
          (games[game] ??= []).push(`{ build: ${JSON.stringify(build)}, module: ${name} }`);
        }
      }
      const entries = Object.entries(games).map(([game, list]) => `${JSON.stringify(game)}: [${list.join(", ")}]`);
      return `${imports.join("\n")}\nexport default { ${entries.join(", ")} };\n`;
    },
  };
}
