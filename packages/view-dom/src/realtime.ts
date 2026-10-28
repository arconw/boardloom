import type { ViewMessages } from "./messages.js";

export type RealtimeStatus =
  | "live"
  | "connecting"
  | "reconnecting"
  | "resyncing"
  | "paused"
  | "degraded"
  | "closed"
  | "error"
  | "updating"
  | "historical";

export interface BoardloomRealtimeStatus {
  readonly status: RealtimeStatus;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly lastUpdate?: number;
}

export interface RealtimeLabel {
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

export function realtimeLabel(status: BoardloomRealtimeStatus | null | undefined): RealtimeLabel {
  if (status === undefined || status === null) {
    return { key: "viewer.meta.historical", params: undefined };
  }
  switch (status.status) {
    case "live":
      return { key: "viewer.realtime.live", params: undefined };
    case "connecting":
      return { key: "viewer.realtime.connecting", params: undefined };
    case "reconnecting":
      return {
        key: "viewer.realtime.reconnecting",
        params: {
          attempt: status.attempt ?? 1,
          max: status.maxAttempts ?? 10,
        },
      };
    case "resyncing":
      return { key: "viewer.realtime.resyncing", params: undefined };
    case "paused":
      return { key: "viewer.realtime.paused", params: undefined };
    case "degraded":
      return { key: "viewer.realtime.degraded", params: undefined };
    case "closed":
      return { key: "viewer.realtime.closed", params: undefined };
    case "error":
      return { key: "viewer.realtime.error", params: undefined };
    case "updating":
      return { key: "viewer.realtime.updating", params: undefined };
    case "historical":
    default:
      return { key: "viewer.meta.historical", params: undefined };
  }
}

export function realtimeText(
  status: BoardloomRealtimeStatus | null | undefined,
  messages: ViewMessages,
): { readonly key: string; readonly text: string } {
  const label = realtimeLabel(status);
  return {
    key: label.key,
    text:
      label.params === undefined
        ? messages.text(label.key)
        : messages.text(label.key, label.params),
  };
}
