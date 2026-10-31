import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { isTransientConvexFailure } from "./vercel-build.mjs";

// The Cloudflare Workers counterpart of scripts/vercel-build.mjs.
//
//   node scripts/cloudflare-build.mjs --target preview     [--build-only]
//   node scripts/cloudflare-build.mjs --target production  [--build-only]
//
// production: deploys the Convex functions to the production deployment
// first, and builds the Worker inside `convex deploy --cmd ...` so the build
// gets the production NEXT_PUBLIC_CONVEX_URL -- the same contract as Vercel's
// main builds: the site and its backend go out together, and a missing deploy
// key is a hard failure rather than a quiet frontend-only release. Then it
// uploads the Worker "orinks-net".
//
// preview: never touches Convex. It builds with `--mode preview` (Worker
// "orinks-net-preview", not indexed, its own visit-counter key) against
// whatever NEXT_PUBLIC_* values are in the environment, and uploads it.
//
// --build-only stops after the build (no Convex deploy for production, no
// Worker upload), for checking a build locally.

export function parseArgs(argv) {
  const args = { target: undefined, buildOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = argv[++i];
    else if (arg.startsWith("--target=")) args.target = arg.slice("--target=".length);
    else if (arg === "--build-only") args.buildOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.target !== "preview" && args.target !== "production") {
    throw new Error("Pass --target preview or --target production");
  }
  return args;
}

export function classifyCloudflareBuild({ target, hasDeployKey, buildOnly = false }) {
  if (target === "production" && !buildOnly) {
    if (!hasDeployKey) {
      throw new Error("production is missing its Convex production deploy key (CONVEX_DEPLOY_KEY)");
    }
    return { deployBackend: true, mode: "production", reason: "production deploys the Convex backend with the Worker" };
  }
  return {
    deployBackend: false,
    mode: target,
    reason: target === "production" ? "production build only (no deploy)" : "preview Worker, Convex untouched",
  };
}

export function viteBuildCommand(mode) {
  return `npx vite build --mode ${mode}`;
}

export function convexDeployArgs(mode) {
  return [
    "convex",
    "deploy",
    "--typecheck",
    "try",
    "--cmd-url-env-var-name",
    "NEXT_PUBLIC_CONVEX_URL",
    "--cmd",
    viteBuildCommand(mode),
  ];
}

export function workerDeployArgs(mode) {
  return ["vinext-cloudflare", "deploy", "--skip-build", "--env", mode];
}

function run(command, args, { capture = false } = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });
}

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function main() {
  const { target, buildOnly } = parseArgs(process.argv.slice(2));
  const decision = classifyCloudflareBuild({
    target,
    buildOnly,
    hasDeployKey: Boolean(process.env.CONVEX_DEPLOY_KEY),
  });
  console.log(`Cloudflare build decision: ${decision.reason}`);

  if (decision.deployBackend) {
    for (let attempt = 1; ; attempt += 1) {
      const deployment = run("npx", convexDeployArgs(decision.mode), { capture: true });
      printResult(deployment);
      if (deployment.status === 0) break;
      const output = `${deployment.stdout ?? ""}\n${deployment.stderr ?? ""}`;
      if (attempt === 3 || !isTransientConvexFailure(output)) {
        throw new Error("Convex production deployment or Worker build failed");
      }
      console.log(`Transient Convex failure; retrying (${attempt + 1}/3)`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
  } else {
    const build = run("npx", viteBuildCommand(decision.mode).split(" ").slice(1));
    if (build.status !== 0) throw new Error(`Worker ${decision.mode} build failed`);
  }

  if (buildOnly) return;

  const upload = run("npx", workerDeployArgs(decision.mode));
  if (upload.status !== 0) throw new Error(`Worker ${decision.mode} upload failed`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
