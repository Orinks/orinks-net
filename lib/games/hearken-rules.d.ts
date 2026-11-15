// The rules modules bundled into the Cloudflare Worker by
// scripts/hearken-rules-plugin.mjs, by game.
declare module "virtual:hearken-rules" {
  const games: Record<string, { build: string; module: WebAssembly.Module }[]>;
  export default games;
}
