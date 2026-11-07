// Fetches each Hearken game's published rules modules from its GitHub
// releases into hearken-rules/<game>/, so a deploy carries every release's
// module without anyone copying files. Games and their release repositories
// are listed in hearken-rules/sources.json. A release attaches its module as
// <game>-<version>-rules-<id>.wasm (`hearken release` names it).
//
//   node scripts/fetch-hearken-rules.mjs
//
// GITHUB_TOKEN, when set, is only used to raise GitHub's rate limit. A failed
// request fails the script, so a deploy never goes out with modules missing
// and refuses runs the last deploy accepted.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "hearken-rules");
const MODULE = /^[a-z0-9][a-z0-9._-]*-rules-[0-9a-f]{12}\.wasm$/;
// How many of a game's newest releases keep their module: older copies of
// the game stop being able to post runs. Each module is a few hundred KB of
// the Worker's size.
const RELEASES = 40;

/** Fetches every listed game's modules into `root`. Answers how many were new. */
export async function fetchRules({ root = ROOT, token = process.env.GITHUB_TOKEN, get = fetch, log = console.log } = {}) {
  async function github(url) {
    const headers = { accept: "application/vnd.github+json", "user-agent": "orinks-net-deploy" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await get(url, { headers, redirect: "follow" });
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    return response;
  }
  const sources = JSON.parse(readFileSync(join(root, "sources.json"), "utf8"));
  let fetched = 0;
  for (const [game, { repo }] of Object.entries(sources)) {
    const dir = join(root, game);
    mkdirSync(dir, { recursive: true });
    const releases = await (await github(`https://api.github.com/repos/${repo}/releases?per_page=${RELEASES}`)).json();
    const assets = releases
      .filter((r) => !r.draft)
      .flatMap((r) => r.assets ?? [])
      .filter((a) => MODULE.test(a.name));
    for (const asset of assets) {
      const path = join(dir, asset.name);
      if (existsSync(path)) continue;
      writeFileSync(path, new Uint8Array(await (await github(asset.browser_download_url)).arrayBuffer()));
      fetched++;
    }
    log(`${game}: ${assets.length} rules modules from ${repo}`);
  }
  return fetched;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Fetched ${await fetchRules()} new.`);
}
