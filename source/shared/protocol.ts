import * as v from "valibot";
import type { _Proof_, _Role_ } from "./brand.ts";
import type { _Author_Doctor_, _Document_Doctor_ } from "./domain.ts";
import type { _NonEmpty_ } from "./list.ts";
import { authorSchema, documentSchema } from "./schema.ts";

export type _Token_Endpoint_ = _Role_<string, "EndpointToken">;
export type _Url_Endpoint_ = _Proof_<string, "EndpointUrl">;

// 32 random bytes, in base64url
export const tokenSchema: v.GenericSchema<unknown, _Token_Endpoint_> = v.custom<_Token_Endpoint_>(
  (input) => typeof input === "string" && /^[A-Za-z0-9_-]{43}$/.test(input),
);

export const endpointUrlSchema: v.GenericSchema<unknown, _Url_Endpoint_> = v.custom<_Url_Endpoint_>(
  (input) => typeof input === "string" && /^https?:\/\/\S+\/$/.test(input),
);

const issuesSchema: v.GenericSchema<unknown, _NonEmpty_<string>> = v.tupleWithRest([v.string()], v.string());

export type _Message_Client_ = _OPEN_Message__Client_;

interface __BASE_Message__Client_<__MessageKind__ extends string> {
  kind: __MessageKind__;
}

export interface _OPEN_Message__Client_ extends __BASE_Message__Client_<"open"> {
  file: string;
}

export const clientMessageSchema: v.GenericSchema<unknown, _Message_Client_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("open"), file: v.string() }),
]);

export type _Message_Server_ =
  | _WELCOME_Message__Server_
  | _OPENED_Message__Server_
  | _UNREADABLE_Message__Server_;

interface __BASE_Message__Server_<__MessageKind__ extends string> {
  kind: __MessageKind__;
}

export interface _WELCOME_Message__Server_ extends __BASE_Message__Server_<"welcome"> {
  caller: _Author_Doctor_;
}

export interface _OPENED_Message__Server_ extends __BASE_Message__Server_<"opened"> {
  file: string;
  document: _Document_Doctor_;
}

export interface _UNREADABLE_Message__Server_ extends __BASE_Message__Server_<"unreadable"> {
  file: string;
  issues: _NonEmpty_<string>;
}

export const serverMessageSchema: v.GenericSchema<unknown, _Message_Server_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("welcome"), caller: authorSchema }),
  v.strictObject({ kind: v.literal("opened"), file: v.string(), document: documentSchema }),
  v.strictObject({ kind: v.literal("unreadable"), file: v.string(), issues: issuesSchema }),
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
  v.strictObject({
    kind: v.literal("document"),
    endpoint: endpointUrlSchema,
    token: tokenSchema,
    file: v.string(),
  }),
  v.strictObject({ kind: v.literal("dashboard"), endpoint: endpointUrlSchema, token: tokenSchema }),
]);
