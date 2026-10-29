# Boardloom Svelte example

Runnable Svelte 5 consumer with deterministic synthetic revenue data. The example imports
`@boardloom/svelte`, `@boardloom/view-dom` and `@boardloom/core` from the built staging packages
in `.tmp/build/packages`, not from workspace source aliases.

## Run

From the repository root:

```sh
npm install
npm run build
npm run dev --workspace @boardloom/example-svelte
```

`npm run build` builds every package into `.tmp/build/packages` and then builds this example into
`.tmp/examples/svelte`. Use `npm run preview --workspace @boardloom/example-svelte` to serve the
production output.

The default `typecheck` script resolves package types from workspace source so it works before a
build. After building, `npm run typecheck:built --workspace @boardloom/example-svelte` checks the
example against the staged declaration files. `verify:consumers` runs that built-declaration check.

## What it demonstrates

- Creating a Boardloom runtime and space from a synthetic board document through the Svelte
  adapter and its bindable handle.
- Locale and timezone selection across the identifiers accepted by the shared core, with the board
  instance preserved. Only the English message dictionary is built in, so UI labels remain English
  while number, date and timezone presentation changes; full messages and RTL arrive in T17.
- Host message overrides for the viewer and editor mode labels.
- Viewer/editor switching through the shared DOM controls and through host imperative actions.
- Focus, export and unmount actions through the bindable handle.
- Lifecycle counts, remounting and cleanup checks.
- Retained dirty-session controls: unmounting with an uncommitted draft keeps the session, shows it
  in the retained list, and lets the host apply or discard it before remounting.
- Host event forwarding, including locale, mode, draft and query events.

All rows, labels and dates are synthetic. This example does not claim complete built-in locale
dictionaries, full locale acceptance or Arabic RTL; those belong to T17.
