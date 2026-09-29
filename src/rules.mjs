/*
 * The checks. Each one looks at a file's full text but only reports
 * findings on lines the pull request added, so nobody is blamed for
 * code they didn't touch. Add `uxkin-ignore` to a line (or
 * `uxkin-ignore-next-line` on the line above) to silence it.
 *
 * Severities: "error" (clearly broken for some users), "warning"
 * (likely a problem, worth a look) and "notice" (a generic pattern
 * worth a second thought).
 */

const MARKUP = /\.(tsx|jsx|vue|svelte|astro|html)$/i;
const STYLES = /\.(css|scss|sass|less)$/i;

export const CHECKS = [
  {
    id: "img-alt",
    severity: "error",
    title: "Image without alt text",
    help: "Add alt text that says what the image shows, or alt=\"\" if it's decorative."
  },
  {
    id: "lorem-ipsum",
    severity: "error",
    title: "Lorem ipsum",
    help: "Replace placeholder text with real copy in the product's words."
  },
  {
    id: "placeholder-link",
    severity: "warning",
    title: "Link that goes nowhere",
    help: "Point the link at a real destination, or use a <button> if it performs an action."
  },
  {
    id: "empty-handler",
    severity: "warning",
    title: "Control that does nothing",
    help: "Wire the handler to the real action, or remove or disable the control until it works."
  },
  {
    id: "click-on-div",
    severity: "warning",
    title: "Click handler on a non-interactive element",
    help: "Use a <button> (or a link), so keyboard and screen reader users can reach it."
  },
  {
    id: "input-label",
    severity: "warning",
    title: "Form field without a label",
    help: "Give the field a <label>, aria-label or aria-labelledby. A placeholder isn't a label."
  },
  {
    id: "outline-removed",
    severity: "warning",
    title: "Focus outline removed",
    help: "Keep a visible focus style, for example with :focus-visible, so keyboard users can see where they are."
  },
  {
    id: "positive-tabindex",
    severity: "warning",
    title: "Positive tabindex",
    help: "Use tabIndex 0 or -1 and fix the order in the markup instead; positive values break the tab order."
  },
  {
    id: "missing-states",
    severity: "warning",
    title: "Data list without all its states",
    help: "Design what people see while it loads, when the request fails, and when there's nothing to show yet."
  },
  {
    id: "hardcoded-color",
    severity: "warning",
    title: "New hard-coded color",
    help: "Use one of the project's existing colors or tokens, or add it to the design tokens on purpose, so screens stay consistent."
  },
  {
    id: "placeholder-copy",
    severity: "warning",
    title: "Placeholder content",
    help: "Replace sample names and filler text with realistic content."
  },
  {
    id: "generic-gradient",
    severity: "notice",
    title: "Purple-to-blue gradient",
    help: "The default AI-generated look. Check it fits the product's own palette."
  },
  {
    id: "generic-label",
    severity: "notice",
    title: "Generic button label",
    help: "Say what happens, for example \"Save changes\" or \"Create project\"."
  },
  {
    id: "emoji-icon",
    severity: "notice",
    title: "Emoji used as an icon",
    help: "Use the project's icon set; emoji render differently on every platform and are read aloud by screen readers."
  }
];

const BY_ID = Object.fromEntries(CHECKS.map(check => [check.id, check]));

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

// The whole tag starting at `index` ("<img ... >"), respecting {} and quotes.
export function tagAt(text, index) {
  let depth = 0;
  let quote = null;
  for (let i = index + 1; i < text.length && i < index + 4000; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === ">" && depth === 0) return text.slice(index, i + 1);
  }
  return text.slice(index, index + 400);
}

function looksLikeColor(hex) {
  const value = hex.slice(1);
  return value.length >= 6 || /\d/.test(value) || /^([a-f])\1\1$/i.test(value);
}

/*
 * Runs every enabled check on one file. `added` is the set of line
 * numbers the change added; `hasSibling(name)` says whether a file with
 * that base name exists in the same folder (for loading.tsx/error.tsx).
 */
// "#ABC" → "#aabbcc", "rgb(1, 2, 3" → "rgb(1,2,3", for comparing colors.
export function normalizeColor(value) {
  const lower = value.toLowerCase().replace(/\s+/g, "");
  const short = lower.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/);
  if (short) return "#" + short.slice(1).filter(Boolean).map(c => c + c).join("");
  return lower;
}

export function colorsIn(text) {
  const found = new Set();
  for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g)) {
    found.add(normalizeColor(match[0]));
  }
  return found;
}

/*
 * `knownColors`, when given, is every color the project already used
 * before this change: only colors new to the project count as drift.
 */
export function checkFile({ path, text, added, disabled = new Set(), isTokenFile = () => false, hasSibling = () => false, knownColors = null }) {
  const findings = [];
  const starts = lineStarts(text);
  const lines = text.split("\n");
  const markup = MARKUP.test(path);
  const styles = STYLES.test(path);

  const ignored = line =>
    /uxkin-ignore(?!-next-line)/.test(lines[line - 1] || "") ||
    /uxkin-ignore-next-line/.test(lines[line - 2] || "");

  const seen = new Set();
  function report(id, index, message) {
    if (disabled.has(id)) return;
    const line = lineAt(starts, index);
    if (!added.has(line) || ignored(line)) return;
    const key = `${id}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    const check = BY_ID[id];
    findings.push({
      id,
      severity: check.severity,
      title: check.title,
      message: message ? `${message} ${check.help}` : check.help,
      path,
      line
    });
  }

  function scan(pattern, fn) {
    for (const match of text.matchAll(pattern)) fn(match);
  }

  if (markup) {
    scan(/<(img|Image)\b/g, match => {
      const tag = tagAt(text, match.index);
      if (!/\balt\s*=/.test(tag) && !/\{\s*\.\.\./.test(tag)) report("img-alt", match.index);
    });

    scan(/\bhref\s*=\s*(?:"#"|'#'|\{\s*["'`]#["'`]\s*\}|"javascript:[^"]*"|'javascript:[^']*')/g, match =>
      report("placeholder-link", match.index)
    );

    scan(
      /\bon[A-Z]\w*\s*=\s*\{\s*(?:\(\s*\w*\s*\)\s*=>\s*(?:\{\s*\}|null|undefined|void 0)|function\s*\(\s*\)\s*\{\s*\}|undefined|null|noop)\s*\}|\bonclick\s*=\s*""|@click\s*=\s*""/g,
      match => report("empty-handler", match.index)
    );

    scan(/<(div|span|li|td|p|section|article)\b/g, match => {
      const tag = tagAt(text, match.index);
      if (/\bonClick\s*=/.test(tag) && !/\brole\s*=/.test(tag)) {
        report("click-on-div", match.index, `A <${match[1]}> has an onClick.`);
      }
    });

    scan(/<(input|textarea|select)\b/g, match => {
      const tag = tagAt(text, match.index);
      if (/\btype\s*=\s*["'{]?\s*["']?(hidden|submit|button|reset|image)\b/.test(tag)) return;
      if (/\b(aria-label|aria-labelledby|id|title)\s*=/.test(tag) || /\{\s*\.\.\./.test(tag)) return;
      const before = text.slice(Math.max(0, match.index - 300), match.index);
      const openLabel = before.lastIndexOf("<label");
      if (openLabel !== -1 && before.indexOf("</label>", openLabel) === -1) return;
      report("input-label", match.index);
    });

    scan(/\btab[iI]ndex\s*=\s*(?:\{\s*[1-9]\d*\s*\}|["'][1-9]\d*["'])/g, match =>
      report("positive-tabindex", match.index)
    );

    scan(/>\s*(Click here|Submit)\s*</g, match =>
      report("generic-label", match.index, `The label is "${match[1]}".`)
    );

    scan(/>\s*\p{Extended_Pictographic}️?\s*</gu, match => report("emoji-icon", match.index));
  }

  if (markup || styles) {
    const focusStyled = /focus-visible|focus:ring|focus:outline|focus-within/.test(text);
    scan(/\boutline-none\b|\boutline\s*:\s*(?:none|0)\b/g, match => {
      const line = lines[lineAt(starts, match.index) - 1];
      if (!focusStyled && !/focus/.test(line)) report("outline-removed", match.index);
    });

    if (!isTokenFile(path)) {
      scan(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g, match => {
        const value = match[0];
        if (knownColors?.has(normalizeColor(value))) return;
        if (value.startsWith("#")) {
          if (![4, 5, 7, 9].includes(value.length) || !looksLikeColor(value)) return;
          const before = text.slice(Math.max(0, match.index - 12), match.index);
          if (/(href|to|id|url)\s*=\s*\{?\s*["'`]?$/i.test(before)) return;
          // "Order #4821", "PR #1234": numbers in text, not colors.
          if (/^#\d{3,4}$/.test(value) && /[A-Za-z]\s$/.test(before) && !/\b(solid|dashed|dotted|double)\s$/i.test(before)) return;
        }
        const line = lines[lineAt(starts, match.index) - 1];
        if (/^\s*--[\w-]+\s*:/.test(line)) return;
        const shown = value.startsWith("#") ? value : `${value})`;
        report(
          "hardcoded-color",
          match.index,
          knownColors ? `${shown} isn't used anywhere else in the project.` : `Found ${shown}.`
        );
      });
    }

    scan(
      /\bfrom-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b[^"'`\n]*\bto-(?:blue|pink|cyan|sky)-\d{2,3}\b|linear-gradient\([^)]*(?:purple|violet|#8b5cf6|#7c3aed|#a855f7|#6366f1)[^)]*(?:blue|#3b82f6|#2563eb|#06b6d4|#0ea5e9)[^)]*\)/gi,
      match => report("generic-gradient", match.index)
    );
  }

  scan(/lorem ipsum/gi, match => report("lorem-ipsum", match.index));

  scan(
    /\b(John Doe|Jane Doe|Your Company|Company Name|Your Name Here|example@example\.com|Title goes here|Description goes here|Some text here)\b/gi,
    match => report("placeholder-copy", match.index, `Found "${match[1]}".`)
  );

  if (markup && !disabled.has("missing-states")) {
    const fetchMatch = text.match(/\b(fetch\(|useQuery\(|useSuspenseQuery\(|useInfiniteQuery\(|useSWR\(|axios\.|useFetch\(|\$fetch\(|createResource\()/);
    // The first list rendered from data: skip fixed arrays written
    // in the file itself (const PLANS = [...]) and ALL_CAPS constants.
    let mapMatch = null;
    for (const match of text.matchAll(/([\w$]+)\??\.map\(/g)) {
      const name = match[1];
      if (/^[A-Z0-9_]+$/.test(name)) continue;
      // Allows a type annotation, which may contain ";" and "=>".
      const literal = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, "\\$")}\\s*(?::(?:[^=]|=>)*?)?=\\s*\\[`);
      if (literal.test(text)) continue;
      mapMatch = match;
      break;
    }
    if (fetchMatch && mapMatch) {
      const missing = [];
      const loading =
        hasSibling("loading") ||
        /\b(?:is)?(?:loading|pending|fetching)\w*|\b(?:Skeleton|Spinner|Suspense|fallback)\b/i.test(text);
      const error =
        hasSibling("error") || /\b(error|isError|catch|ErrorBoundary|onError|failed)\b/i.test(text);
      const empty =
        /\.length\s*(?:===?|!==?|<|>|<=|>=)\s*\d|!\s*[\w.?]+\??\.length\b|\.length\s*\?|\.length\s*&&|\bisEmpty\b|\bempty\b|EmptyState|No \w+ (?:yet|found)/i.test(text);
      if (!loading) missing.push("loading");
      if (!error) missing.push("error");
      if (!empty) missing.push("empty");
      if (missing.length) {
        const fetchLine = lineAt(starts, fetchMatch.index);
        const mapLine = lineAt(starts, mapMatch.index);
        const anchor = added.has(mapLine) ? mapMatch.index : fetchMatch.index;
        if (added.has(fetchLine) || added.has(mapLine)) {
          const list = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} or ${missing.at(-1)}` : missing[0];
          report("missing-states", anchor, `This loads data and renders a list, but no ${list} state was found.`);
        }
      }
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}
