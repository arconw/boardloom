<script lang="ts">
  import { onDestroy } from "svelte";
  import { BoardloomSession } from "./session.js";
  import type { BoardloomViewHandle, BoardloomViewProps } from "./types.js";

  let {
    space,
    runtime,
    runtimeOptions,
    document,
    datasetProvider,
    view,
    mode,
    lease,
    locale,
    timezone,
    theme,
    messages,
    messageDictionaries,
    realtime,
    provenance,
    blockTypes,
    renderers,
    extensions,
    extensionSelection,
    draftDecision,
    handle = $bindable(null),
    class: className,
    style,
    containerProps,
    onEvent,
    onModeChange,
    onImportDocument,
    onExport,
    onReady,
    onDispose,
    onError,
  }: BoardloomViewProps = $props();

  let container = $state<HTMLDivElement | null>(null);

  const session = new BoardloomSession({
    onEvent: (event) => onEvent?.(event),
    onModeChange: (nextMode, event) => onModeChange?.(nextMode, event),
    onImportDocument: (input, fileName) => onImportDocument?.(input, fileName),
    onExport: (kind, serialization) => onExport?.(kind, serialization),
    onReady: (info) => onReady?.(info),
    onDispose: (info) => onDispose?.(info),
    onError: (error) => onError?.(error),
    onHandle: (nextHandle) => {
      handle = nextHandle;
    },
    draftDecision: () => draftDecision,
  });

  $effect(() => {
    if (container === null) {
      return;
    }
    session.sync(
      {
        space,
        runtime,
        runtimeOptions,
        document,
        datasetProvider,
        view,
        mode,
        lease,
        locale,
        timezone,
        theme,
        messages,
        messageDictionaries,
        realtime,
        provenance,
        blockTypes,
        renderers,
        extensions,
        extensionSelection,
        draftDecision,
        onImportDocument,
      },
      container,
    );
  });

  onDestroy(() => {
    session.dispose();
  });

  export function getHandle(): BoardloomViewHandle | null {
    return session.handle;
  }

  const mergedClass = $derived(
    [containerProps?.class, className]
      .filter((value) => value !== undefined && value !== "")
      .join(" ") || undefined,
  );
  const mergedStyle = $derived(
    [containerProps?.style, style]
      .filter((value) => value !== undefined && value !== "")
      .join("; ") || undefined,
  );
</script>

<div
  {...containerProps}
  bind:this={container}
  data-boardloom-svelte=""
  class={mergedClass}
  style={mergedStyle}
></div>
