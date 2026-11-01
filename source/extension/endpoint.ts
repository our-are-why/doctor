import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import type { _Author_Doctor_ } from "../shared/domain.ts";
import { parse, parseOwn } from "../shared/parse.ts";
import {
  clientMessageSchema,
  tokenSchema,
  type _Message_Client_,
  type _Message_Server_,
  type _Token_Endpoint_,
} from "../shared/protocol.ts";

export type _Handler_Endpoint_ = (
  caller: _Author_Doctor_,
  message: _Message_Client_,
  reply: (message: _Message_Server_) => void,
) => void;

export interface _Tokens_Endpoint_ {
  human: _Token_Endpoint_;
  agent: _Token_Endpoint_;
}

export interface _Running_Endpoint_ {
  port: number;
  close: () => Promise<void>;
}

type _Caller_Endpoint_ = _KNOWN_Caller__Endpoint_ | _UNKNOWN_Caller__Endpoint_;

interface __BASE_Caller__Endpoint_<__CallerKind__ extends string> {
  kind: __CallerKind__;
}

interface _KNOWN_Caller__Endpoint_ extends __BASE_Caller__Endpoint_<"known"> {
  author: _Author_Doctor_;
}

interface _UNKNOWN_Caller__Endpoint_ extends __BASE_Caller__Endpoint_<"unknown"> {}

export function mintToken(): _Token_Endpoint_ {
  return parseOwn(tokenSchema, randomBytes(32).toString("base64url"));
}

function matches(token: _Token_Endpoint_, presented: string): boolean {
  const expected = Buffer.from(token);
  const actual = Buffer.from(presented);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function identify(tokens: _Tokens_Endpoint_, presented: string): _Caller_Endpoint_ {
  if (matches(tokens.human, presented)) return { kind: "known", author: "human" };
  if (matches(tokens.agent, presented)) return { kind: "known", author: "agent" };
  return { kind: "unknown" };
}

function bearerOf(request: IncomingMessage): string {
  return request.headers.authorization?.replace(/^Bearer /, "") ?? "";
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function send(socket: { send: (data: string) => void }, message: _Message_Server_): void {
  socket.send(JSON.stringify(message));
}

export function startEndpoint(
  tokens: _Tokens_Endpoint_,
  handle: _Handler_Endpoint_,
): Promise<_Running_Endpoint_> {
  const server = createServer((request, response) => {
    const caller = identify(tokens, bearerOf(request));
    if (caller.kind === "unknown") {
      respond(response, 401, { error: "unknown caller" });
      return;
    }
    if (request.method === "GET" && request.url === "/status") {
      respond(response, 200, { caller: caller.author });
      return;
    }
    respond(response, 404, { error: "no such route" });
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const caller = identify(tokens, url.searchParams.get("token") ?? "");
    if (url.pathname !== "/socket" || caller.kind === "unknown") {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      const reply = (message: _Message_Server_) => send(client, message);
      client.on("message", (data, isBinary) => {
        if (isBinary || !Buffer.isBuffer(data)) return;
        let raw: unknown;
        try {
          raw = JSON.parse(data.toString("utf8"));
        } catch {
          return;
        }
        const result = parse(clientMessageSchema, raw);
        if (result.kind === "parsed") handle(caller.author, result.value, reply);
      });
      reply({ kind: "welcome", caller: caller.author });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the endpoint isn't listening on a TCP port"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((closed) => {
            sockets.close();
            server.close(() => closed());
          }),
      });
    });
  });
}
