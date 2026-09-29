# UXKIN UI Check

A GitHub Action that checks the frontend code a pull request adds, before it merges. It looks for controls that do nothing, data lists without loading, error or empty states, new one-off colors, accessibility basics and generic AI-generated patterns, and reports them as pull request annotations and in the job summary.

- No account, token or external service. Your code never leaves the runner.
- Only lines the pull request **added** are checked, so nobody is blamed for existing code.
- No dependencies to install.

## Usage

Add `.github/workflows/ui-check.yml` to your repository:

```yaml
name: UI check

on:
  pull_request:

permissions:
  contents: read

jobs:
  ui-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: uxkin/ui-check@v1
```

Findings show up on the changed lines in the pull request's **Files changed** tab and in the job summary. By default only errors fail the job.

## Options

```yaml
      - uses: uxkin/ui-check@v1
        with:
          fail-on: warning            # error (default), warning or never
          paths: "src/**/*.{tsx,css}" # which files to check
          ignore: "src/legacy/**"     # extra files to skip
          disable: "generic-label"    # checks to turn off
```

| Input | Default | What it does |
|---|---|---|
| `fail-on` | `error` | Fail the job on findings of this severity or worse: `error`, `warning` or `never`. |
| `paths` | `**/*.{tsx,jsx,ts,js,vue,svelte,astro,html,css,scss}` | Comma or newline separated globs of files to check. |
| `ignore` | | Globs to skip, on top of build folders, `node_modules`, tests and stories. |
| `disable` | | Comma separated check ids to turn off. |
| `base` | pull request base | Commit to compare against. On `push` it uses the previous commit. |

Outputs: `errors`, `warnings` and `notices` (counts).

## What it checks

| Check | Severity | Finds |
|---|---|---|
| `img-alt` | error | `<img>` or `<Image>` without `alt` |
| `lorem-ipsum` | error | Lorem ipsum text |
| `placeholder-link` | warning | `href="#"` and `javascript:` links |
| `empty-handler` | warning | `onClick={() => {}}` and other handlers that do nothing |
| `click-on-div` | warning | `onClick` on a `<div>`, `<span>` or similar without a `role` |
| `input-label` | warning | `<input>`, `<textarea>` or `<select>` without a label |
| `outline-removed` | warning | `outline: none` or `outline-none` with no focus style |
| `positive-tabindex` | warning | `tabIndex` greater than 0 |
| `missing-states` | warning | A component that fetches data and renders a list, with no loading, error or empty state (a Next.js `loading` or `error` file next to it counts) |
| `hardcoded-color` | warning | A hex or rgb color that isn't used anywhere else in the project (colors in token and theme files are fine) |
| `placeholder-copy` | warning | "John Doe", "Your Company", "example@example.com" and similar |
| `generic-gradient` | notice | Purple-to-blue gradients |
| `generic-label` | notice | Buttons labelled "Submit" or "Click here" |
| `emoji-icon` | notice | An emoji used on its own as an icon |

To silence one line, add a comment containing `uxkin-ignore` on it, or `uxkin-ignore-next-line` on the line above.

## What it isn't

A source check, not a visual review. A clean run means none of these checks matched the new code; it doesn't mean the screen looks right or is easy to use. Look at the rendered result before merging, for example with the [coding agent UI checklist](https://uxkin.com/coding-agent-ui-checklist).

For better UI while it's being built, give your coding agent the free [no-ui-slop skill](https://uxkin.com/docs), and optionally connect [UXKIN](https://uxkin.com) for real app and website references.

## Development

```bash
node --test test/*.test.mjs
```

## License

MIT
