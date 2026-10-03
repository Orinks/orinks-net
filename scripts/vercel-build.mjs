import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function classifyVercelBuild({ branch, hasDeployKey }) {
  // main is orinks.net itself, and its backend must go out with its frontend:
  // the site and the Freight Fate cloud-save validator are one release, so
  // shipping the pages against yesterday's Convex functions is how a green
  // Vercel build hides a half-deployed production. A missing key is a hard
  // failure here rather than a quiet fall-through to a frontend-only build --
  // the quiet version is indistinguishable from success until a player's
  // backup is refused.
  if (branch === "main") {
    if (!hasDeployKey) {
      throw new Error("main is missing its Convex production deploy key");
    }
    return {
      deployBackend: true,
      target: "production",
      reason: "main deploys the production backend",
    };
  }
  // Every other branch, dev included, is an ordinary preview: it builds the
  // site against the preview-wide Convex URL (the staging backend) and never
  // deploys a backend of its own.
  return { deployBackend: false, reason: "ordinary frontend preview" };
}

export function isTransientConvexFailure(output) {
  if (/InvalidModules|unauthorized|invalid deploy key|schema|typecheck/i.test(output)) {
    return false;
  }
  return /(?:HTTP(?: status)?|status(?: code)?)\D*(?:408|5\d\d)\b/i.test(output);
}

export function convexDeployArgs() {
  return [
    "convex",
    "deploy",
    "--typecheck",
    "try",
    "--cmd-url-env-var-name",
    "NEXT_PUBLIC_CONVEX_URL",
    "--cmd",
    "npm run build",
  ];
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
}

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function main() {
  const decision = classifyVercelBuild({
    branch: process.env.VERCEL_GIT_COMMIT_REF,
    hasDeployKey: Boolean(process.env.CONVEX_DEPLOY_KEY),
  });
  console.log(`Vercel build decision: ${decision.reason}`);
  if (!decision.deployBackend) {
    const build = run("npm", ["run", "build"]);
    printResult(build);
    if (build.status !== 0) throw new Error("Next.js preview build failed");
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const deployment = run("npx", convexDeployArgs());
    printResult(deployment);
    if (deployment.status === 0) return;
    const output = `${deployment.stdout ?? ""}\n${deployment.stderr ?? ""}`;
    if (attempt === 3 || !isTransientConvexFailure(output)) {
      throw new Error(`Convex ${decision.target} deployment or Next.js build failed`);
    }
    console.log(`Transient Convex failure; retrying (${attempt + 1}/3)`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
  }

}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
