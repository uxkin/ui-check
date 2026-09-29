import assert from "node:assert/strict";
import { test } from "node:test";

import { addedLines } from "../src/diff.mjs";
import { matcher } from "../src/glob.mjs";
import { CHECKS, checkFile } from "../src/rules.mjs";

// Treat every line as added unless told otherwise.
function run(text, { path = "src/App.tsx", added, ...rest } = {}) {
  const all = new Set(text.split("\n").map((_, i) => i + 1));
  return checkFile({ path, text, added: added ?? all, ...rest });
}
const ids = findings => findings.map(f => f.id);

test("every check has a severity, title and help", () => {
  for (const check of CHECKS) {
    assert.ok(["error", "warning", "notice"].includes(check.severity), check.id);
    assert.ok(check.title && check.help, check.id);
  }
});

test("img-alt", () => {
  assert.deepEqual(ids(run('<img src="/a.png" />')), ["img-alt"]);
  assert.deepEqual(ids(run('<Image\n  src={hero}\n  width={200}\n/>')), ["img-alt"]);
  assert.deepEqual(ids(run('<img src="/a.png" alt="" />')), []);
  assert.deepEqual(ids(run("<img {...props} />")), []);
});

test("lorem-ipsum and placeholder-copy", () => {
  assert.deepEqual(ids(run("<p>Lorem ipsum dolor sit amet</p>")), ["lorem-ipsum"]);
  assert.deepEqual(ids(run("<p>Signed in as John Doe</p>")), ["placeholder-copy"]);
  assert.deepEqual(ids(run("<p>Signed in as {user.name}</p>")), []);
});

test("placeholder-link", () => {
  assert.deepEqual(ids(run('<a href="#">Pricing</a>')), ["placeholder-link"]);
  assert.deepEqual(ids(run("<a href={'#'}>Pricing</a>")), ["placeholder-link"]);
  assert.deepEqual(ids(run('<a href="javascript:void(0)">Pricing</a>')), ["placeholder-link"]);
  assert.deepEqual(ids(run('<a href="#pricing">Pricing</a>')), []);
});

test("empty-handler", () => {
  assert.deepEqual(ids(run("<button onClick={() => {}}>Save changes</button>")), ["empty-handler"]);
  assert.deepEqual(ids(run("<button onClick={() => null}>Save changes</button>")), ["empty-handler"]);
  assert.deepEqual(ids(run("<button onClick={save}>Save changes</button>")), []);
});

test("click-on-div", () => {
  assert.deepEqual(ids(run("<div className=\"card\" onClick={open}>Open</div>")), ["click-on-div"]);
  assert.deepEqual(ids(run("<div role=\"button\" tabIndex={0} onClick={open}>Open</div>")), []);
  assert.deepEqual(ids(run("<button onClick={open}>Open</button>")), []);
});

test("input-label", () => {
  assert.deepEqual(ids(run('<input placeholder="Email" />')), ["input-label"]);
  assert.deepEqual(ids(run('<input id="email" />')), []);
  assert.deepEqual(ids(run('<input aria-label="Email" />')), []);
  assert.deepEqual(ids(run('<label>Email <input type="email" /></label>')), []);
  assert.deepEqual(ids(run('<input type="hidden" name="t" />')), []);
});

test("positive-tabindex", () => {
  assert.deepEqual(ids(run("<div role=\"tab\" tabIndex={2}>A</div>")), ["positive-tabindex"]);
  assert.deepEqual(ids(run("<div role=\"tab\" tabIndex={0}>A</div>")), []);
});

test("outline-removed", () => {
  assert.deepEqual(ids(run('<button className="outline-none">Save changes</button>')), ["outline-removed"]);
  assert.deepEqual(ids(run('<button className="outline-none focus-visible:ring-2">Save changes</button>')), []);
  assert.deepEqual(ids(run(".btn { outline: none; }", { path: "src/app.css" })), ["outline-removed"]);
  assert.deepEqual(ids(run(".btn { outline: none; }\n.btn:focus-visible { box-shadow: 0 0 0 2px; }", { path: "src/app.css" })), []);
});

test("hardcoded-color", () => {
  assert.deepEqual(ids(run('<p style={{ color: "#1a73e8" }}>Hi</p>')), ["hardcoded-color"]);
  assert.deepEqual(ids(run('<p className="text-[#fff]">Hi</p>')), ["hardcoded-color"]);
  assert.deepEqual(ids(run(".a { color: rgb(10, 20, 30); }", { path: "src/a.css" })), ["hardcoded-color"]);
  assert.deepEqual(ids(run(":root {\n  --brand: #1a73e8;\n}", { path: "src/a.css" })), []);
  assert.deepEqual(ids(run(".a { color: #1a73e8; }", { path: "src/theme.css", isTokenFile: () => true })), []);
  assert.deepEqual(ids(run('<a href="#add">Add</a>')), []);
  assert.deepEqual(ids(run('<p style={{ color: "var(--brand)" }}>Hi</p>')), []);
});

test("generic-gradient, generic-label and emoji-icon", () => {
  assert.deepEqual(ids(run('<div className="bg-gradient-to-r from-purple-500 to-blue-500">Hi</div>')), ["generic-gradient"]);
  assert.deepEqual(ids(run("<button>Submit</button>")), ["generic-label"]);
  assert.deepEqual(ids(run("<button>Create project</button>")), []);
  assert.deepEqual(ids(run("<span>🚀</span>")), ["emoji-icon"]);
  assert.deepEqual(ids(run("<span>Launch 🚀 today</span>")), []);
});

test("missing-states", () => {
  const bare = `export function Projects() {
  const { data } = useQuery({ queryKey: ["p"], queryFn: getProjects });
  return <ul>{data.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}`;
  const found = run(bare);
  assert.deepEqual(ids(found), ["missing-states"]);
  assert.match(found[0].message, /no loading, error or empty state/);

  const complete = `export function Projects() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["p"], queryFn: getProjects });
  if (isLoading) return <Spinner />;
  if (isError) return <p>Couldn't load projects. <button onClick={refetch}>Try again</button></p>;
  if (!data.length) return <EmptyState />;
  return <ul>{data.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}`;
  assert.deepEqual(ids(run(complete)), []);

  // Next.js loading.tsx and error.tsx next to the page count.
  const page = `export default async function Page() {
  const projects = await fetch(API).then(r => r.json());
  if (projects.length === 0) return <p>No projects yet</p>;
  return <ul>{projects.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}`;
  assert.deepEqual(ids(run(page, { hasSibling: name => name === "loading" || name === "error" })), []);
  assert.deepEqual(ids(run(page)), ["missing-states"]);
});

test("only added lines are reported", () => {
  const text = '<img src="/old.png" />\n<img src="/new.png" />';
  const found = run(text, { added: new Set([2]) });
  assert.deepEqual(found.map(f => f.line), [2]);
});

test("uxkin-ignore and disable", () => {
  assert.deepEqual(ids(run('<a href="#">Menu</a> {/* uxkin-ignore */}')), []);
  assert.deepEqual(ids(run('{/* uxkin-ignore-next-line */}\n<a href="#">Menu</a>')), []);
  assert.deepEqual(ids(run('<a href="#">Menu</a>', { disabled: new Set(["placeholder-link"]) })), []);
});

test("checks don't run on files they don't apply to", () => {
  assert.deepEqual(ids(run('const url = "#";\nconst c = "#1a73e8";', { path: "src/config.ts" })), []);
});

test("addedLines parses a -U0 diff", () => {
  const diff = `diff --git a/src/A.tsx b/src/A.tsx
index 1..2 100644
--- a/src/A.tsx
+++ b/src/A.tsx
@@ -3,0 +4,2 @@ export
+one
+two
@@ -10 +12 @@ x
-old
+new
diff --git a/gone.tsx b/gone.tsx
--- a/gone.tsx
+++ /dev/null
@@ -1 +0,0 @@
-bye`;
  const files = addedLines(diff);
  assert.deepEqual([...files.keys()], ["src/A.tsx"]);
  assert.deepEqual([...files.get("src/A.tsx")], [4, 5, 12]);
});

test("glob matcher", () => {
  const match = matcher(["**/*.{tsx,css}"]);
  assert.ok(match("App.tsx"));
  assert.ok(match("src/components/App.tsx"));
  assert.ok(match("src/a.css"));
  assert.ok(!match("src/a.ts"));
  const ignore = matcher(["**/node_modules/**", "**/*.test.*"]);
  assert.ok(ignore("node_modules/x/a.tsx"));
  assert.ok(ignore("src/a.test.tsx"));
  assert.ok(!ignore("src/a.tsx"));
});

test("parseList keeps commas inside braces", async () => {
  const { parseList } = await import("../src/glob.mjs");
  assert.deepEqual(parseList("**/*.{tsx,css}, src/**\nlib/*.js"), ["**/*.{tsx,css}", "src/**", "lib/*.js"]);
});

test("hardcoded-color only flags colors new to the project", async () => {
  const { normalizeColor, colorsIn } = await import("../src/rules.mjs");
  assert.equal(normalizeColor("#ABC"), "#aabbcc");
  assert.equal(normalizeColor("rgb( 1, 2, 3"), "rgb(1,2,3");
  const known = colorsIn(".a { color: #141414; background: #FFF; }");
  assert.deepEqual(ids(run('<p className="text-[#141414] bg-[#ffffff]">Hi</p>', { knownColors: known })), []);
  const found = run('<p className="text-[#1a73e8]">Hi</p>', { knownColors: known });
  assert.deepEqual(ids(found), ["hardcoded-color"]);
  assert.match(found[0].message, /#1a73e8 isn't used anywhere else in the project/);
});

test("hardcoded-color ignores numbers in text", () => {
  assert.deepEqual(ids(run('<Screen title="Order #4821">x</Screen>')), []);
  assert.deepEqual(ids(run("<p>Fixed in PR #1234</p>")), []);
  assert.deepEqual(ids(run(".a { border: 1px solid #333; }", { path: "src/a.css" })), ["hardcoded-color"]);
});
