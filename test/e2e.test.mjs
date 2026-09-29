import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const MAIN = resolve(import.meta.dirname, "../src/main.mjs");

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "uxkin-check-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"), { recursive: true });
  // Existing code with problems that this pull request doesn't touch.
  writeFileSync(join(dir, "src/Old.tsx"), '<img src="/legacy.png" />\n<a href="#">Old</a>\n');
  writeFileSync(join(dir, "src/Nav.tsx"), "export function Nav() {\n  return <nav>Home</nav>;\n}\n");
  writeFileSync(join(dir, "src/Brand.tsx"), '<p className="text-[#141414]">Brand</p>\n');
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");

  // The pull request.
  writeFileSync(
    join(dir, "src/Nav.tsx"),
    'export function Nav() {\n  return <nav>Home <a href="#">Pricing</a> <img src="/logo.png" /></nav>;\n}\n'
  );
  writeFileSync(
    join(dir, "src/Projects.tsx"),
    `export function Projects() {
  const { data } = useQuery({ queryKey: ["p"], queryFn: getProjects });
  return <ul className="text-[#1a73e8]">{data.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}
`
  );
  writeFileSync(join(dir, "src/Projects.test.tsx"), '<img src="/x.png" />\n');
  writeFileSync(join(dir, "src/api.ts"), 'export const color = "#1a73e8";\n');
  // Reusing an existing project color isn't drift.
  writeFileSync(join(dir, "src/Footer.tsx"), '<footer className="text-[#141414]">Footer</footer>\n');
  git("add", ".");
  git("commit", "-q", "-m", "pr");

  const event = join(dir, "event.json");
  writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: base } } }));
  return { dir, event };
}

function runAction(dir, event, inputs = {}) {
  const summaryFile = join(dir, "summary.md");
  const outputFile = join(dir, "output.txt");
  writeFileSync(summaryFile, "");
  writeFileSync(outputFile, "");
  const env = {
    ...process.env,
    GITHUB_EVENT_PATH: event,
    GITHUB_STEP_SUMMARY: summaryFile,
    GITHUB_OUTPUT: outputFile
  };
  for (const [key, value] of Object.entries(inputs)) env[`INPUT_${key.toUpperCase()}`] = value;
  const result = spawnSync("node", [MAIN], { cwd: dir, env, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout,
    summary: readFileSync(summaryFile, "utf8"),
    outputs: Object.fromEntries(
      readFileSync(outputFile, "utf8").trim().split("\n").filter(Boolean).map(line => line.split("="))
    )
  };
}

test("checks only what the pull request added and fails on errors", () => {
  const { dir, event } = repo();
  const result = runAction(dir, event);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /::error file=src\/Nav\.tsx,line=2,title=UXKIN%3A Image without alt text::/);
  assert.match(result.stdout, /::warning file=src\/Nav\.tsx,line=2,title=UXKIN%3A Link that goes nowhere::/);
  assert.match(result.stdout, /::warning file=src\/Projects\.tsx,line=3,title=UXKIN%3A Data list without all its states::/);
  assert.match(result.stdout, /::warning file=src\/Projects\.tsx,line=3,title=UXKIN%3A New hard-coded color::#1a73e8 isn't used anywhere else/);

  // Untouched old code, test files and plain .ts files are left alone.
  assert.doesNotMatch(result.stdout, /Old\.tsx|Projects\.test\.tsx|api\.ts|Footer\.tsx/);

  assert.deepEqual(result.outputs, { errors: "1", warnings: "3", notices: "0" });
  assert.match(result.summary, /## UXKIN UI Check/);
  assert.match(result.summary, /in 4 frontend files: \*\*1 error\*\*, 3 warnings, 0 notices/);
  assert.match(result.summary, /`src\/Nav\.tsx:2` \| Image without alt text/);
  assert.match(result.summary, /not a visual review/);
});

test("fail-on never and disable", () => {
  const { dir, event } = repo();
  const never = runAction(dir, event, { "fail-on": "never" });
  assert.equal(never.status, 0);
  assert.match(never.summary, /don't fail this job/);

  const disabled = runAction(dir, event, { disable: "img-alt" });
  assert.equal(disabled.status, 0);
  assert.equal(disabled.outputs.errors, "0");

  const strict = runAction(dir, event, { disable: "img-alt", "fail-on": "warning" });
  assert.equal(strict.status, 1);
});

test("no base commit is a notice, not a failure", () => {
  const { dir } = repo();
  const event = join(dir, "empty-event.json");
  writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: "0123456789abcdef0123456789abcdef01234567" } } }));
  const result = runAction(dir, event);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /::notice title=UXKIN UI Check::No base commit/);
});

test("rejects an invalid fail-on", () => {
  const { dir, event } = repo();
  const result = runAction(dir, event, { "fail-on": "sometimes" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /fail-on must be/);
});
