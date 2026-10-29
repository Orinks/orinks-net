import path from "node:path";
import { fileURLToPath } from "node:url";

// Vercel's "Ignored Build Step" (vercel.json ignoreCommand): exit 0 skips the
// deployment, exit 1 builds it. Only main (orinks.net) and dev (the staging
// preview the game's sandbox and testers use) are worth building. Every other
// branch's preview carried a full copy of the site -- about 300 MB, most of it
// audio -- into the team's 10 GB of deployment storage, and its public URL
// drew on the same request quota as the real site.
//
// A deployment with no branch at all (one made from the CLI) is built: that is
// someone deploying on purpose.
export function shouldBuild(branch) {
  if (!branch) return true;
  return branch === "main" || branch === "dev";
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";
  const build = shouldBuild(branch);
  console.log(build ? `Building ${branch || "a branchless deployment"}.` : `Skipping the preview for ${branch}: only main and dev deploy.`);
  process.exit(build ? 1 : 0);
}
