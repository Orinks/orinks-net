"use node";

import { createPrivateKey, sign } from "node:crypto";
import { canonicalSharedProfile } from "./freightFateSharedProfileValidation";

export function signSharedProfile(
  payload: Record<string, unknown>,
  privateKeyBase64: string,
) {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyBase64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, Buffer.from(canonicalSharedProfile(payload), "utf8"), privateKey).toString("base64");
}
