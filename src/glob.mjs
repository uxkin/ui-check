/*
 * Minimal glob matching: *, **, ? and {a,b}. Enough for file filters
 * without a dependency.
 */

function expandBraces(pattern) {
  const match = pattern.match(/\{([^{}]*)\}/);
  if (!match) return [pattern];
  const [whole, body] = match;
  return body
    .split(",")
    .flatMap(part => expandBraces(pattern.replace(whole, part)));
}

function toRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // "**/" matches any number of folders, including none.
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

// Splits on commas and newlines, but not on commas inside {a,b}.
export function parseList(value) {
  const items = [];
  let current = "";
  let depth = 0;
  for (const char of String(value || "")) {
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if ((char === "," && depth === 0) || char === "\n") {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.map(item => item.trim()).filter(Boolean);
}

export function matcher(globs) {
  const patterns = globs.flatMap(expandBraces).map(toRegExp);
  return path => patterns.some(pattern => pattern.test(path));
}
