/*
 * UXKIN UI Check: runs inside a pull request job, reads the frontend
 * lines the change added, and reports findings as annotations and in
 * the job summary. No account, token or network access to UXKIN.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { addedLines } from "./diff.mjs";
import { matcher, parseList } from "./glob.mjs";
import { CHECKS, checkFile, colorsIn } from "./rules.mjs";

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/out/**",
  "**/coverage/**",
  "**/vendor/**",
  "**/*.min.*",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/*.stories.*",
  "**/*.d.ts"
];

const TOKEN_FILES = [
  "**/*{token,tokens,theme,themes,colors,colours,palette,variables}*",
  "**/tailwind.config.*",
  "**/globals.css"
];

const RANK = { error: 3, warning: 2, notice: 1 };
const MAX_ROWS = 50;

function input(name, fallback = "") {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/ /g, "_")}`];
  return value === undefined || value === "" ? fallback : value.trim();
}

function git(args, options = {}) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "pipe"]
  });
}

function hasCommit(sha) {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function ensureCommit(sha) {
  if (hasCommit(sha)) return true;
  try {
    git(["fetch", "--no-tags", "--depth=1", "origin", sha], { quiet: true });
  } catch {
    // Fall through to the check below.
  }
  return hasCommit(sha);
}

function readEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function findBase(event) {
  const override = input("base");
  if (override) return override;
  if (event.pull_request?.base?.sha) return event.pull_request.base.sha;
  if (event.before && !/^0+$/.test(event.before)) return event.before;
  return hasCommit("HEAD~1") ? "HEAD~1" : "";
}

// GitHub workflow command escaping.
function escapeData(value) {
  return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(value) {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function annotate(finding) {
  const level = finding.severity === "notice" ? "notice" : finding.severity;
  console.log(
    `::${level} file=${escapeProperty(finding.path)},line=${finding.line},title=${escapeProperty(
      `UXKIN: ${finding.title}`
    )}::${escapeData(finding.message)}`
  );
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function cell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function summary(findings, { filesChecked, failOn, failed }) {
  const count = severity => findings.filter(f => f.severity === severity).length;
  const icon = { error: "🔴", warning: "🟡", notice: "🔵" };
  const out = ["## UXKIN UI Check", ""];

  if (!filesChecked) {
    out.push("No changed frontend files to check.");
  } else if (!findings.length) {
    out.push(`Checked the lines this change added in ${filesChecked} frontend file${filesChecked === 1 ? "" : "s"}. No findings.`);
  } else {
    out.push(
      `Checked the lines this change added in ${filesChecked} frontend file${filesChecked === 1 ? "" : "s"}: ` +
        `**${count("error")} error${count("error") === 1 ? "" : "s"}**, ${count("warning")} warning${count("warning") === 1 ? "" : "s"}, ` +
        `${count("notice")} notice${count("notice") === 1 ? "" : "s"}.`,
      "",
      "| | Where | Check | What to do |",
      "|---|---|---|---|",
      ...findings
        .slice(0, MAX_ROWS)
        .map(f => `| ${icon[f.severity]} | \`${cell(f.path)}:${f.line}\` | ${cell(f.title)} | ${cell(f.message)} |`)
    );
    if (findings.length > MAX_ROWS) {
      out.push("", `…and ${findings.length - MAX_ROWS} more. The job log lists every finding.`);
    }
  }

  out.push(
    "",
    failed
      ? `This job failed because of findings at \`${failOn}\` level or above (set with \`fail-on\`).`
      : failOn === "never"
        ? "Findings don't fail this job (`fail-on: never`)."
        : `Only findings at \`${failOn}\` level or above fail this job.`,
    "",
    "> This is a source check, not a visual review. A clean run means none of these checks matched; look at the rendered screens before merging. " +
      "[UI review checklist](https://uxkin.com/coding-agent-ui-checklist) · Silence a line with `uxkin-ignore`."
  );
  return out.join("\n") + "\n";
}

function main() {
  const failOn = input("fail-on", "error").toLowerCase();
  if (!["error", "warning", "never", "notice"].includes(failOn)) {
    console.log(`::error title=UXKIN UI Check::fail-on must be error, warning or never (got "${failOn}").`);
    process.exit(1);
  }

  const include = matcher(parseList(input("paths", "**/*.{tsx,jsx,ts,js,vue,svelte,astro,html,css,scss}")));
  const ignore = matcher([...DEFAULT_IGNORE, ...parseList(input("ignore"))]);
  const isTokenFile = matcher(TOKEN_FILES);
  const known = new Set(CHECKS.map(check => check.id));
  const disabled = new Set(parseList(input("disable")));
  for (const id of disabled) {
    if (!known.has(id)) console.log(`::warning title=UXKIN UI Check::Unknown check "${id}" in disable.`);
  }

  const event = readEvent();
  const base = findBase(event);
  if (!base || !ensureCommit(base)) {
    console.log(
      "::notice title=UXKIN UI Check::No base commit to compare against, so there was nothing to check. Run it on pull_request or push events."
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## UXKIN UI Check\n\nNo base commit to compare against, so nothing was checked.\n");
    }
    return;
  }

  const diff = git(["diff", "-U0", "--no-color", "--no-ext-diff", "--diff-filter=AMR", base, "HEAD"]);
  const changed = addedLines(diff);

  // Colors the project already used before this change, plus colors
  // defined in token files this change touches, aren't drift.
  let knownColors = null;
  try {
    knownColors = colorsIn(
      git(["grep", "-h", "-o", "-I", "-E", "#[0-9a-fA-F]{3,8}\\b|rgba?\\( *[0-9]+ *, *[0-9]+ *, *[0-9]+", base, "--", "."], { quiet: true })
    );
  } catch (error) {
    // git grep exits 1 when nothing matches: no colors known yet.
    knownColors = error?.status === 1 ? new Set() : null;
  }
  if (knownColors) {
    for (const path of changed.keys()) {
      if (isTokenFile(path) && existsSync(path)) {
        for (const color of colorsIn(readFileSync(path, "utf8"))) knownColors.add(color);
      }
    }
  }

  const findings = [];
  let filesChecked = 0;
  for (const [path, added] of changed) {
    if (!include(path) || ignore(path) || !existsSync(path)) continue;
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;
    const text = readFileSync(path, "utf8");
    if (text.includes("\u0000")) continue;
    filesChecked += 1;

    const folder = dirname(path);
    let siblings = null;
    const hasSibling = name => {
      siblings ??= readdirSync(folder).map(file => basename(file, extname(file)));
      return siblings.includes(name);
    };

    findings.push(...checkFile({ path, text, added, disabled, isTokenFile, hasSibling, knownColors }));
  }

  findings.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.path.localeCompare(b.path) || a.line - b.line);
  findings.forEach(annotate);

  const threshold = failOn === "never" ? Infinity : RANK[failOn];
  const failed = findings.some(f => RANK[f.severity] >= threshold);
  const count = severity => findings.filter(f => f.severity === severity).length;

  setOutput("errors", count("error"));
  setOutput("warnings", count("warning"));
  setOutput("notices", count("notice"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(findings, { filesChecked, failOn, failed }));
  }

  console.log(
    `UXKIN UI Check: ${filesChecked} file(s) checked, ${count("error")} error(s), ${count("warning")} warning(s), ${count("notice")} notice(s).`
  );
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.log(`::error title=UXKIN UI Check::${escapeData(error?.message || String(error))}`);
    process.exit(1);
  }
}
