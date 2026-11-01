import { parse, type _Result_Parse_ } from "../shared/parse.ts";
import { webviewConfigSchema, type _Config_Webview_ } from "../shared/protocol.ts";

export function readConfig(): _Result_Parse_<_Config_Webview_> {
  const text = document.getElementById("doctor-config")?.textContent ?? "";
  try {
    const raw: unknown = JSON.parse(text);
    return parse(webviewConfigSchema, raw);
  } catch (someError) {
    return { kind: "rejected", issues: [`the page's config isn't JSON: ${String(someError)}`] };
  }
}
