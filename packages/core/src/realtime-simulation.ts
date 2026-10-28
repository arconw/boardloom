import { DIAGNOSTIC_CODES, createDiagnostic } from "./diagnostics.js";
import {
  validateRealtimeEnvelope,
  type RealtimeCommand,
  type RealtimeConnectionStatus,
  type RealtimeSubscriptionRequest,
  type RealtimeTransport,
  type RealtimeTransportListener,
  type RealtimeTransportStatus,
  type RealtimeTransportSubscription,
} from "./realtime-contract.js";

export interface SimulatedRealtimeTransportOptions {
  readonly transportId?: string;
}

export interface SimulatedRealtimeTransport extends RealtimeTransport {
  readonly simulated: true;
  publish(value: unknown): number;
  setConnection(status: RealtimeConnectionStatus): void;
  disconnect(): void;
  reconnect(): void;
  subscriptionCount(): number;
}

interface SimulationSubscription {
  readonly request: RealtimeSubscriptionRequest;
  readonly listener: RealtimeTransportListener;
  readonly subscriptionToken: number;
}

export function createSimulatedRealtimeTransport(
  options: SimulatedRealtimeTransportOptions = {},
): SimulatedRealtimeTransport {
  let sequence = 0;
  let connection: RealtimeConnectionStatus = "open";
  const subscriptions = new Map<number, SimulationSubscription>();
  const transportId =
    typeof options.transportId === "string" && options.transportId.trim() !== ""
      ? options.transportId
      : "simulation";

  const statusFor = (): RealtimeTransportStatus =>
    Object.freeze({
      status: connection,
      attempt: connection === "reconnecting" ? 1 : 0,
      maxAttempts: 10,
    });

  const setConnection = (status: RealtimeConnectionStatus): void => {
    connection = status;
    for (const entry of subscriptions.values()) {
      entry.listener.onStatus(statusFor());
    }
  };

  const publish = (value: unknown): number => {
    if (connection !== "open" && connection !== "resyncing") {
      return 0;
    }
    const admitted = validateRealtimeEnvelope(value);
    if (!admitted.ok) {
      for (const entry of subscriptions.values()) {
        entry.listener.onError(
          admitted.diagnostics[0] ??
            createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ENVELOPE_INVALID, "realtime"),
        );
      }
      return 0;
    }
    const envelope = admitted.value;
    let delivered = 0;
    for (const entry of [...subscriptions.values()]) {
      if (
        entry.request.queryKey === envelope.queryKey &&
        entry.request.generation === envelope.generation &&
        entry.request.datasetId === envelope.datasetId &&
        entry.request.sliceId === envelope.sliceId
      ) {
        entry.listener.onEnvelope(envelope);
        delivered += 1;
      }
    }
    return delivered;
  };

  return Object.freeze({
    transportId,
    simulated: true as const,
    subscribe(
      request: RealtimeSubscriptionRequest,
      listener: RealtimeTransportListener,
    ): RealtimeTransportSubscription {
      sequence += 1;
      const subscriptionToken = sequence;
      const entry: SimulationSubscription = Object.freeze({ request, listener, subscriptionToken });
      subscriptions.set(subscriptionToken, entry);
      listener.onStatus(statusFor());
      return Object.freeze({
        send(command: RealtimeCommand): void {
          if (!subscriptions.has(subscriptionToken)) {
            return;
          }
          if (command.type === "close") {
            subscriptions.delete(subscriptionToken);
            listener.onStatus(
              Object.freeze({
                status: "closed",
                attempt: 0,
                maxAttempts: 10,
              }) as RealtimeTransportStatus,
            );
            return;
          }
          if (command.type === "resync") {
            listener.onStatus(
              Object.freeze({
                status: "resyncing",
                attempt: 0,
                maxAttempts: 10,
              }) as RealtimeTransportStatus,
            );
          }
        },
        close(): void {
          subscriptions.delete(subscriptionToken);
        },
      });
    },
    publish,
    setConnection,
    disconnect(): void {
      setConnection("reconnecting");
    },
    reconnect(): void {
      setConnection("open");
    },
    subscriptionCount(): number {
      return subscriptions.size;
    },
  });
}
