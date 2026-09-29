/*
 * Reads `git diff -U0` output and returns, per file, the line numbers
 * the change added (in the new version of the file).
 */

export function addedLines(diffText) {
  const files = new Map();
  let current = null;
  let line = 0;

  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).trim();
      current = path === "/dev/null" ? null : path.replace(/^b\//, "");
      if (current && !files.has(current)) files.set(current, new Set());
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("+")) {
      files.get(current).add(line);
      line += 1;
    } else if (raw.startsWith(" ")) {
      line += 1;
    }
  }

  for (const [path, lines] of files) {
    if (!lines.size) files.delete(path);
  }
  return files;
}
