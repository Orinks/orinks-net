import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function classifyStagingRun({ enabled, eventName, ref }) {
  if (enabled !== "true") {
    return { deploy: false, reason: "temporary staging is disabled" };
  }
  if (eventName !== "push") {
    return { deploy: false, reason: "not a push event" };
  }
  if (ref !== "refs/heads/dev") {
    return { deploy: false, reason: "not the dev branch" };
  }
  return { deploy: true, reason: "enabled dev push" };
}

export function isTransientConvexFailure(output) {
  if (/InvalidModules|unauthorized|invalid deploy key|schema|typecheck/i.test(output)) {
    return false;
  }
  return /(?:HTTP(?: status)?|status(?: code)?)\D*(?:408|5\d\d)\b/i.test(output);
}

export function missingStagingCredentials(environment) {
  return ["CONVEX_DEPLOY_KEY", "VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"].filter(
    (name) => !environment[name],
  );
}

function runConvex(args) {
  return spawnSync("npx", ["convex", "deploy", ...args], {
    encoding: "utf8",
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
}

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function runVercel(args) {
  return spawnSync("npx", ["vercel", ...args, "--token", process.env.VERCEL_TOKEN], {
    encoding: "utf8",
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
}

async function main() {
  const decision = classifyStagingRun({
    enabled: process.env.FREIGHT_FATE_STAGING_ENABLED,
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
  });
  console.log(`Staging decision: ${decision.reason}; commit: ${process.env.GITHUB_SHA ?? "unknown"}`);
  if (!decision.deploy) return;

  const missingCredentials = missingStagingCredentials(process.env);
  if (missingCredentials.length > 0) {
    throw new Error(`Temporary staging credentials are missing: ${missingCredentials.join(", ")}`);
  }

  const dryRun = runConvex(["--dry-run", "--typecheck", "try"]);
  printResult(dryRun);
  if (dryRun.status !== 0) throw new Error("Convex dry-run validation failed");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const deployment = runConvex([]);
    printResult(deployment);
    if (deployment.status === 0) break;
    const output = `${deployment.stdout ?? ""}\n${deployment.stderr ?? ""}`;
    if (attempt === 3 || !isTransientConvexFailure(output)) {
      throw new Error("Convex staging deployment failed");
    }
    console.log(`Transient Convex failure; retrying (${attempt + 1}/3)`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
  }

  const vercelDeployment = runVercel(["deploy", "--yes"]);
  printResult(vercelDeployment);
  if (vercelDeployment.status !== 0) throw new Error("Vercel staging deployment failed");
  const deploymentUrl = `${vercelDeployment.stdout ?? ""}\n${vercelDeployment.stderr ?? ""}`
    .match(/https:\/\/[^\s]+\.vercel\.app\b/)?.[0];
  if (!deploymentUrl) throw new Error("Vercel CLI did not return a deployment URL");

  const alias = runVercel(["alias", "set", deploymentUrl, "dev.orinks.net"]);
  printResult(alias);
  if (alias.status !== 0) throw new Error("Vercel staging alias assignment failed");
  console.log(`Staging deployed at ${deploymentUrl} and assigned to dev.orinks.net`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
