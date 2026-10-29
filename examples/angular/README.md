# Boardloom Angular example

Runnable Angular standalone-component example for `@boardloom/angular`. It uses synthetic revenue data only and mounts the shared Boardloom DOM runtime through the built adapter package.

The example demonstrates:

- Standalone `BoardloomViewComponent` inputs and outputs.
- Locale and timezone selection with state-preserving updates.
- Host message overrides.
- Host-driven editor and viewer switching through the component's input and imperative handle.
- Focus, export, variant-document remount and unmount/remount cleanup.
- A retained dirty-session panel when an adapter-owned space cannot be disposed safely.

## Run

Build the workspace packages first:

```sh
npm run build
```

Then start the example:

```sh
npm run dev --workspace @boardloom/example-angular
```

`ng build` writes the production output under `.tmp/examples/angular`. The build resolves `@boardloom/angular`, `@boardloom/core` and `@boardloom/view-dom` from `.tmp/build/packages` through `tsconfig.app.json`, not from workspace source aliases.

## Scope

The example proves the Angular 21.2 integration path, including AOT compilation of the packed component. Only the English message foundation is built in; complete built-in locale dictionaries, Arabic RTL acceptance and the final consumer tarball matrix belong to T17 and T19.
