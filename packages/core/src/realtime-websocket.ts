import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  createDiagnostic,
  type Diagnostic,
} from "./diagnostics.js";
import {
  DEFAULT_REALTIME_RECONNECT,
  type RealtimeCommand,
  type RealtimeConnectionStatus,
  type RealtimeSubscriptionRequest,
  type RealtimeTransport,
  type RealtimeTransportListener,
  type RealtimeTransportStatus,
  type RealtimeTransportSubscription,
} from "./realtime-contract.js";

export interface RealtimeSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export type RealtimeSocketFactory = (
  url: string,
  protocols?: string | readonly string[],
) => RealtimeSocket;

export interface RealtimeTimerHost {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WebSocketRealtimeTransportOptions {
  readonly url: string;
  readonly protocols?: string | readonly string[];
  readonly createSocket?: RealtimeSocketFactory;
  readonly reconnect?: Partial<typeof DEFAULT_REALTIME_RECONNECT>;
  readonly maxMessageBytes?: number;
  readonly random?: () => number;
  readonly timerHost?: RealtimeTimerHost;
}

export interface WebSocketRealtimeTransport extends RealtimeTransport {
  readonly simulated: false;
}

const SOCKET_OPEN = 1;

function defaultTimerHost(): RealtimeTimerHost {
  const host = globalThis as unknown as {
    setTimeout?: (callback: () => void, delayMs: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };
  return Object.freeze({
    setTimeout: (callback: () => void, delayMs: number) =>
      typeof host.setTimeout === "function" ? host.setTimeout(callback, delayMs) : 0,
    clearTimeout: (handle: unknown) => {
      if (typeof host.clearTimeout === "function") {
        host.clearTimeout(handle);
      }
    },
  });
}

function defaultSocketFactory(ctor: RealtimeSocketFactory | undefined): RealtimeSocketFactory {
  if (ctor !== undefined) {
    return ctor;
  }
  const globalConstructor = (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  if (typeof globalConstructor !== "function") {
    throw new BoardloomError(
      createDiagnostic(DIAGNOSTIC_CODES.REALTIME_TRANSPORT_UNAVAILABLE, "realtime", {
        message: "No WebSocket implementation is available in this host.",
      }),
    );
  }
  return (url, protocols) => {
    const Constructor = globalConstructor as new (
      url: string,
      protocols?: string | readonly string[],
    ) => RealtimeSocket;
    return protocols === undefined ? new Constructor(url) : new Constructor(url, protocols);
  };
}

function socketMessageData(event: unknown): unknown {
  if (typeof event === "object" && event !== null) {
    return (event as { readonly data?: unknown }).data;
  }
  return undefined;
}

export function createWebSocketRealtimeTransport(
  options: WebSocketRealtimeTransportOptions,
): WebSocketRealtimeTransport {
  if (typeof options.url !== "string" || options.url.trim() === "") {
    throw new BoardloomError(
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "realtime/url", {
        message: "A WebSocket realtime transport requires a non-empty consumer-provided URL.",
      }),
    );
  }
  if (
    options.maxMessageBytes !== undefined &&
    (typeof options.maxMessageBytes !== "number" ||
      !Number.isFinite(options.maxMessageBytes) ||
      options.maxMessageBytes <= 0)
  ) {
    throw new BoardloomError(
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "realtime/maxMessageBytes", {
        message: "maxMessageBytes must be a positive finite number.",
      }),
    );
  }
  const createSocket = defaultSocketFactory(options.createSocket);
  const timerHost = options.timerHost ?? defaultTimerHost();
  const random = options.random ?? Math.random;
  const maxMessageBytes = options.maxMessageBytes ?? 8 * 1024 * 1024;
  const policy = {
    ...DEFAULT_REALTIME_RECONNECT,
    ...(options.reconnect ?? {}),
  };

  return Object.freeze({
    transportId: "websocket",
    simulated: false as const,
    subscribe(
      request: RealtimeSubscriptionRequest,
      listener: RealtimeTransportListener,
    ): RealtimeTransportSubscription {
      let closed = false;
      let socket: RealtimeSocket | null = null;
      let socketToken = 0;
      let attempt = 0;
      let reconnectHandle: unknown = null;
      let hasOpened = false;
      let pendingResync: RealtimeCommand | null = null;
      let status: RealtimeConnectionStatus = "connecting";

      const reportStatus = (
        next: RealtimeConnectionStatus,
        extra: {
          readonly attempt?: number;
          readonly maxAttempts?: number;
          readonly diagnostic?: Diagnostic;
        } = {},
      ): void => {
        if (closed && next !== "closed") {
          return;
        }
        status = next;
        listener.onStatus(
          Object.freeze({
            status: next,
            attempt: extra.attempt ?? attempt,
            maxAttempts: extra.maxAttempts ?? policy.maxAttempts,
            ...(extra.diagnostic === undefined ? {} : { diagnostic: extra.diagnostic }),
          }) as RealtimeTransportStatus,
        );
      };

      const clearReconnect = (): void => {
        if (reconnectHandle !== null) {
          timerHost.clearTimeout(reconnectHandle);
          reconnectHandle = null;
        }
      };

      const sendFrame = (value: unknown): void => {
        if (socket === null || socket.readyState !== SOCKET_OPEN) {
          return;
        }
        try {
          socket.send(JSON.stringify(value));
        } catch {
          reportStatus("error", {
            diagnostic: createDiagnostic(
              DIAGNOSTIC_CODES.REALTIME_SUBSCRIPTION_FAILED,
              "realtime",
              {
                message: "The realtime socket could not send a subscription frame.",
              },
            ),
          });
        }
      };

      const subscribeFrame = (): Record<string, unknown> => ({
        type: "subscribe",
        request: {
          subscriptionId: request.subscriptionId,
          queryId: request.queryId,
          queryKey: request.queryKey,
          datasetId: request.datasetId,
          ...(request.sliceId === undefined ? {} : { sliceId: request.sliceId }),
          generation: request.generation,
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
          keyFields: request.keyFields,
          limits: request.limits,
        },
      });

      const reconnectDelay = (): number => {
        const base = Math.min(
          policy.maxDelayMs,
          policy.initialDelayMs * Math.pow(policy.factor, Math.max(0, attempt - 1)),
        );
        const jitter = Math.max(0, policy.jitter);
        return Math.max(0, Math.round(base * (1 + (random() * 2 - 1) * jitter)));
      };

      const open = (): void => {
        if (closed) {
          return;
        }
        socketToken += 1;
        const connectionToken = socketToken;
        clearReconnect();
        reportStatus(hasOpened ? "reconnecting" : "connecting", { attempt });
        let nextSocket: RealtimeSocket;
        try {
          nextSocket = createSocket(
            options.url,
            options.protocols === undefined ? undefined : options.protocols,
          );
        } catch {
          reportStatus("error", {
            diagnostic: createDiagnostic(
              DIAGNOSTIC_CODES.REALTIME_TRANSPORT_UNAVAILABLE,
              "realtime",
              {
                message: "The realtime socket could not be created.",
              },
            ),
          });
          scheduleReconnect();
          return;
        }
        socket = nextSocket;
        const onOpen = (): void => {
          if (closed || connectionToken !== socketToken) {
            return;
          }
          hasOpened = true;
          attempt = 0;
          sendFrame(subscribeFrame());
          reportStatus("open", { attempt: 0 });
          if (pendingResync !== null) {
            sendFrame(pendingResync);
            pendingResync = null;
          }
        };
        const onMessage = (event: unknown): void => {
          if (closed || connectionToken !== socketToken) {
            return;
          }
          const data = socketMessageData(event);
          if (typeof data !== "string") {
            listener.onError(
              createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ENVELOPE_INVALID, "realtime", {
                message: "Realtime messages must be JSON text frames.",
              }),
            );
            return;
          }
          if (data.length > maxMessageBytes) {
            listener.onError(
              createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ENVELOPE_INVALID, "realtime", {
                message: "A realtime message exceeded the configured size limit.",
              }),
            );
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            listener.onError(
              createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ENVELOPE_INVALID, "realtime", {
                message: "A realtime message was not valid JSON.",
              }),
            );
            return;
          }
          listener.onEnvelope(parsed);
        };
        const onError = (): void => {
          if (closed || connectionToken !== socketToken) {
            return;
          }
          listener.onError(
            createDiagnostic(DIAGNOSTIC_CODES.REALTIME_SUBSCRIPTION_FAILED, "realtime", {
              message: "The realtime socket reported an error.",
            }),
          );
        };
        const onClose = (): void => {
          if (connectionToken !== socketToken) {
            return;
          }
          if (socket === nextSocket) {
            socket = null;
          }
          if (closed) {
            return;
          }
          scheduleReconnect();
        };
        nextSocket.addEventListener("open", onOpen);
        nextSocket.addEventListener("message", onMessage);
        nextSocket.addEventListener("error", onError);
        nextSocket.addEventListener("close", onClose);
      };

      const scheduleReconnect = (): void => {
        if (closed) {
          return;
        }
        if (attempt >= policy.maxAttempts) {
          reportStatus("degraded", { attempt, maxAttempts: policy.maxAttempts });
          return;
        }
        attempt += 1;
        reportStatus("reconnecting", { attempt, maxAttempts: policy.maxAttempts });
        reconnectHandle = timerHost.setTimeout(() => {
          reconnectHandle = null;
          open();
        }, reconnectDelay());
      };

      const forceReconnect = (): void => {
        clearReconnect();
        attempt = 0;
        const active = socket;
        socket = null;
        if (active !== null) {
          try {
            active.close();
          } catch {
            void 0;
          }
        }
        open();
      };

      const sendCommand = (command: RealtimeCommand): void => {
        if (closed) {
          return;
        }
        if (command.type === "close") {
          if (socket !== null) {
            sendFrame({ type: "unsubscribe" });
          }
          closed = true;
          clearReconnect();
          const active = socket;
          socket = null;
          if (active !== null) {
            try {
              active.close();
            } catch {
              void 0;
            }
          }
          reportStatus("closed");
          return;
        }
        if (command.type === "resync" && status === "degraded") {
          pendingResync = command;
          forceReconnect();
          return;
        }
        if (socket !== null && socket.readyState === SOCKET_OPEN) {
          sendFrame(command);
        } else {
          pendingResync = command;
        }
      };

      open();

      return Object.freeze({
        send: sendCommand,
        close: () => sendCommand({ type: "close" }),
      });
    },
  });
}
