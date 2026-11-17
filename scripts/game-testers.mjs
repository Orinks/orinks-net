// Adds, removes or lists a Hearken game's testers on the Convex deployment
// CONVEX_DEPLOY_KEY names (.github/workflows/game-testers.yml).
import { execFileSync } from "node:child_process";

const name = (process.env.NAME ?? "").trim();
const action = process.env.ACTION ?? "add";
const game = (process.env.GAME ?? "wickets").trim();

function run(fn, args) {
  // execFile, not a shell: the name is typed by hand and goes in as data.
  return execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], { encoding: "utf8" }).trim();
}

function list() {
  const names = JSON.parse(run("games:listTesters", { game }) || "[]");
  console.log(names.length ? `Testing ${game}: ${names.join(", ")}.` : `Nobody is testing ${game}.`);
}

if (action === "list") {
  list();
} else {
  if (!name) {
    console.error("Type the player's orinks.net name.");
    process.exit(1);
  }
  try {
    const done = JSON.parse(run("games:setTester", { name, game, tester: action === "add" }));
    console.log(`${done.name} ${done.tester ? "now tests" : "no longer tests"} ${game}.`);
  } catch (error) {
    console.error(String(error.stderr || error.message));
    process.exit(1);
  }
  list();
}
