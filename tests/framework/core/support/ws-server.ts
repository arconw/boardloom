import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WebSocketTestConnection {
  readonly id: number;
  send(value: unknown): void;
  close(): void;
}

export interface WebSocketTestServerOptions {
  onSubscribe?(
    request: Record<string, unknown>,
    connection: WebSocketTestConnection,
    server: WebSocketTestServer,
  ): void;
  onMessage?(
    message: Record<string, unknown>,
    connection: WebSocketTestConnection,
    server: WebSocketTestServer,
  ): void;
  onConnection?(connection: WebSocketTestConnection, server: WebSocketTestServer): void;
}

export interface WebSocketTestServer {
  readonly url: string;
  readonly port: number;
  readonly connectionCount: number;
  readonly lastRequest: Record<string, unknown> | null;
  send(value: unknown): void;
  closeClients(): void;
  close(): Promise<void>;
}

interface ClientState {
  readonly id: number;
  readonly socket: Duplex;
  buffer: Buffer;
  frameParts: Buffer[];
  frameOpcode: number | null;
  closed: boolean;
}

function frame(payload: Buffer, opcode: number): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function parseFrames(client: ClientState, onText: (text: string) => void): void {
  while (true) {
    if (client.buffer.length < 2) {
      return;
    }
    const first = client.buffer[0] ?? 0;
    const second = client.buffer[1] ?? 0;
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (client.buffer.length < 4) {
        return;
      }
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) {
        return;
      }
      const big = client.buffer.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        client.socket.destroy();
        return;
      }
      length = Number(big);
      offset = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (client.buffer.length < offset + maskLength + length) {
      return;
    }
    const mask = masked ? client.buffer.subarray(offset, offset + 4) : null;
    offset += maskLength;
    const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
    client.buffer = client.buffer.subarray(offset + length);
    if (mask !== null) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
      }
    }
    if (opcode === 0x8) {
      client.socket.write(frame(Buffer.alloc(0), 0x8));
      client.socket.end();
      return;
    }
    if (opcode === 0x9) {
      client.socket.write(frame(payload, 0xa));
      continue;
    }
    if (opcode === 0xa) {
      continue;
    }
    if (opcode === 0x1 || opcode === 0x0) {
      client.frameParts.push(payload);
      client.frameOpcode = client.frameOpcode ?? opcode;
      if (fin) {
        const text = Buffer.concat(client.frameParts).toString("utf8");
        client.frameParts = [];
        client.frameOpcode = null;
        onText(text);
      }
    }
  }
}

export async function createWebSocketTestServer(
  options: WebSocketTestServerOptions = {},
): Promise<WebSocketTestServer> {
  const clients = new Map<number, ClientState>();
  let nextId = 0;
  let lastRequest: Record<string, unknown> | null = null;
  const server: Server = createServer((_request, response) => {
    response.statusCode = 426;
    response.end("upgrade required");
  });
  const controlsFor = (client: ClientState): WebSocketTestConnection =>
    Object.freeze({
      id: client.id,
      send(value: unknown): void {
        if (client.closed) {
          return;
        }
        const text = JSON.stringify(value);
        client.socket.write(frame(Buffer.from(text, "utf8"), 0x1));
      },
      close(): void {
        if (client.closed) {
          return;
        }
        client.closed = true;
        client.socket.write(frame(Buffer.alloc(0), 0x8));
        client.socket.end();
      },
    });
  const api: WebSocketTestServer = {
    get url() {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      return `ws://127.0.0.1:${port}/realtime`;
    },
    get port() {
      const address = server.address();
      return typeof address === "object" && address !== null ? address.port : 0;
    },
    get connectionCount() {
      return clients.size;
    },
    get lastRequest() {
      return lastRequest;
    },
    send(value: unknown): void {
      for (const client of clients.values()) {
        controlsFor(client).send(value);
      }
    },
    closeClients(): void {
      for (const client of [...clients.values()]) {
        controlsFor(client).close();
      }
    },
    async close(): Promise<void> {
      for (const client of [...clients.values()]) {
        client.closed = true;
        client.socket.destroy();
      }
      clients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string" || key === "") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(`${key}${GUID}`).digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"),
    );
    nextId += 1;
    const client: ClientState = {
      id: nextId,
      socket,
      buffer: Buffer.alloc(0),
      frameParts: [],
      frameOpcode: null,
      closed: false,
    };
    clients.set(client.id, client);
    const connection = controlsFor(client);
    options.onConnection?.(connection, api);
    socket.on("data", (chunk: Buffer) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      try {
        parseFrames(client, (text) => {
          let message: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              return;
            }
            message = parsed as Record<string, unknown>;
          } catch {
            return;
          }
          if (message.type === "subscribe" && typeof message.request === "object") {
            lastRequest = message.request as Record<string, unknown>;
            options.onSubscribe?.(lastRequest, connection, api);
            return;
          }
          options.onMessage?.(message, connection, api);
        });
      } catch {
        socket.destroy();
      }
    });
    socket.on("close", () => {
      client.closed = true;
      clients.delete(client.id);
    });
    socket.on("error", () => {
      client.closed = true;
      clients.delete(client.id);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return api;
}

export function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for a condition."));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}
