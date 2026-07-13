import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const [keyId, outputPath] = process.argv.slice(2);
if (!/^\d{4}-\d{2}(?:-[a-z0-9-]+)?$/.test(keyId ?? "") || !outputPath) {
  console.error("Usage: node scripts/generate-freight-fate-profile-key.mjs YYYY-MM private-key-output.txt");
  process.exit(2);
}
if (existsSync(outputPath)) {
  console.error(`Refusing to replace existing key file: ${outputPath}`);
  process.exit(2);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
const publicDer = publicKey.export({ format: "der", type: "spki" });
const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
if (publicDer.length !== 44 || !publicDer.subarray(0, 12).equals(ed25519SpkiPrefix)) {
  throw new Error("Node returned an unexpected Ed25519 public-key encoding.");
}

writeFileSync(outputPath, `${privateDer.toString("base64")}\n`, {
  encoding: "ascii",
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify({
  keyId,
  publicKeyBase64: publicDer.subarray(12).toString("base64"),
  privateKeyEnv: "FREIGHT_FATE_PROFILE_SIGNING_PRIVATE_KEY",
  keyIdEnv: "FREIGHT_FATE_PROFILE_SIGNING_KEY_ID",
  privateKeyFile: outputPath,
}));
