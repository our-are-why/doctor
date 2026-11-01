import { useEffect, useState } from "preact/hooks";
import type { _Author_Doctor_ } from "../shared/domain.ts";
import { parse } from "../shared/parse.ts";
import { serverMessageSchema, type _Token_Endpoint_, type _Url_Endpoint_ } from "../shared/protocol.ts";

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

export function useConnection(endpoint: _Url_Endpoint_, token: _Token_Endpoint_): _Connection_Webview_ {
  const [connection, setConnection] = useState<_Connection_Webview_>({ kind: "connecting" });

  useEffect(() => {
    const socketUrl = `${endpoint.replace(/^http/, "ws")}socket?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(socketUrl);
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const result = parse(serverMessageSchema, raw);
      if (result.kind === "parsed" && result.value.kind === "welcome") {
        setConnection({ kind: "open", caller: result.value.caller });
      }
    });
    socket.addEventListener("close", () => setConnection({ kind: "closed" }));
    return () => socket.close();
  }, [endpoint, token]);

  return connection;
}
