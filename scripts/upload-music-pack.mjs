// One-off: push the Freight Fate music pack to its exact public-blob
// pathname. The download route validates the URL character for character,
// so addRandomSuffix must be off and the path must be freight-fate/music.pak
// (the CLI's --add-random-suffix=false is ignored in vercel 59, which is why
// this script exists). Token comes from FREIGHT_FATE_PUBLIC_READ_WRITE_TOKEN.
import { put } from "@vercel/blob";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const source = process.argv[2];
const token = process.env.FREIGHT_FATE_PUBLIC_READ_WRITE_TOKEN;
if (!source || !token) {
  console.error("usage: node upload-music-pack.mjs <music.pak> (token in env)");
  process.exit(1);
}
const { size } = await stat(source);
const result = await put("freight-fate/music.pak", createReadStream(source), {
  access: "public",
  addRandomSuffix: false,
  allowOverwrite: true,
  token,
  contentType: "application/octet-stream",
});
console.log(`uploaded ${size} bytes -> ${result.url}`);
