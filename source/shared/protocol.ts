import * as v from "valibot";
import type { _Proof_, _Role_ } from "./brand.ts";
import type { _Author_Doctor_ } from "./domain.ts";

export type _Token_Endpoint_ = _Role_<string, "EndpointToken">;
export type _Url_Endpoint_ = _Proof_<string, "EndpointUrl">;

// 32 random bytes, in base64url
export const tokenSchema: v.GenericSchema<unknown, _Token_Endpoint_> = v.custom<_Token_Endpoint_>(
  (input) => typeof input === "string" && /^[A-Za-z0-9_-]{43}$/.test(input),
);

export const endpointUrlSchema: v.GenericSchema<unknown, _Url_Endpoint_> = v.custom<_Url_Endpoint_>(
  (input) => typeof input === "string" && /^https?:\/\/\S+\/$/.test(input),
);

export const authorSchema: v.GenericSchema<unknown, _Author_Doctor_> = v.picklist(["human", "agent"]);

export type _Message_Server_ = _WELCOME_Message__Server_;

interface __BASE_Message__Server_<__MessageKind__ extends string> {
  kind: __MessageKind__;
}

export interface _WELCOME_Message__Server_ extends __BASE_Message__Server_<"welcome"> {
  caller: _Author_Doctor_;
}

export const serverMessageSchema: v.GenericSchema<unknown, _Message_Server_> = v.variant("kind", [
  v.object({ kind: v.literal("welcome"), caller: authorSchema }),
]);

export type _Config_Webview_ = _DOCUMENT_Config__Webview_ | _DASHBOARD_Config__Webview_;

interface __BASE_Config__Webview_<__ConfigKind__ extends string> {
  kind: __ConfigKind__;
  endpoint: _Url_Endpoint_;
  token: _Token_Endpoint_;
}

export interface _DOCUMENT_Config__Webview_ extends __BASE_Config__Webview_<"document"> {
  file: string;
}

export interface _DASHBOARD_Config__Webview_ extends __BASE_Config__Webview_<"dashboard"> {}

export const webviewConfigSchema: v.GenericSchema<unknown, _Config_Webview_> = v.variant("kind", [
  v.object({
    kind: v.literal("document"),
    endpoint: endpointUrlSchema,
    token: tokenSchema,
    file: v.string(),
  }),
  v.object({ kind: v.literal("dashboard"), endpoint: endpointUrlSchema, token: tokenSchema }),
]);
