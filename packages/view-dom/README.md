# @boardloom/view-dom

Planned package for the Boardloom framework-neutral viewer and editor DOM runtime, accessible shell and scoped design tokens.

Status: T05 implements the scoped token layer in `styles.css`. T06 implements the DOM runtime, viewer shell and state surfaces. No production viewer, editor, chart renderer or live UI exists yet. The package must not depend on a backend, a database or a UI framework.

The token layer declares `--bl-` custom properties inside the `boardloom` cascade layer. A host mounts an instance with the `boardloom` class and a `data-boardloom-theme` value of `light`, `dark` or `system`. Host CSS can override tokens on the scoped root, and multiple instances can use different themes without changing the host page or document direction. The token contract and reference compositions are documented in `docs/design/`.

Distribution target: browser ESM with TypeScript declarations and `@boardloom/view-dom/styles.css`. npm publication is not authorized at T05; the planned scoped name is used for tarball consumers only.
