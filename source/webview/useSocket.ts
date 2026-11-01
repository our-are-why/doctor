import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { _Author_Doctor_ } from "../shared/domain.next.ts";
import { parse } from "../shared/parse.ts";
import {
  serverMessageSchema,
  type _Message_Client_,
  type _Message_Server_,
  type _Token_Endpoint_,
  type _Url_Endpoint_,
} from "../shared/protocol.ts";

export type _Connection_Webview_ =
  | _CONNECTING_Connection__Webview_
  | _OPEN_Connection__Webview_
  | _CLOSED_Connection__Webview_;

interface __BASE_Connection__Webview_<__ConnectionKind__ extends string> {
  kind: __ConnectionKind__;
}

export interface _CONNECTING_Connection__Webview_ extends __BASE_Connection__Webview_<"connecting"> {}

export interface _OPEN_Connection__Webview_ extends __BASE_Connection__Webview_<"open"> {
  caller: _Author_Doctor_;
}

export interface _CLOSED_Connection__Webview_ extends __BASE_Connection__Webview_<"closed"> {}

export interface _Socket_Webview_ {
  connection: _Connection_Webview_;
  send: (message: _Message_Client_) => void;
}

export function useSocket(
  endpoint: _Url_Endpoint_,
  token: _Token_Endpoint_,
  onMessage: (message: _Message_Server_) => void,
): _Socket_Webview_ {
  const [connection, setConnection] = useState<_Connection_Webview_>({ kind: "connecting" });
  const sendRef = useRef<(message: _Message_Client_) => void>(() => {});
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const socket = new WebSocket(`${endpoint.replace(/^http/, "ws")}socket?token=${encodeURIComponent(token)}`);
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const result = parse(serverMessageSchema, raw);
      if (result.kind === "rejected") return;
      if (result.value.kind === "welcome") {
        sendRef.current = (message) => socket.send(JSON.stringify(message));
        setConnection({ kind: "open", caller: result.value.caller });
      }
      onMessageRef.current(result.value);
    });
    socket.addEventListener("close", () => {
      sendRef.current = () => {};
      setConnection({ kind: "closed" });
    });
    return () => {
      sendRef.current = () => {};
      socket.close();
    };
  }, [endpoint, token]);

  const send = useCallback((message: _Message_Client_) => sendRef.current(message), []);
  return { connection, send };
}
