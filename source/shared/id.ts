import { parseOwn, type _Schema_Parse_ } from "./parse.ts";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

// random is ten random bytes, from whichever source the caller has
export function mintId<__Id__>(schema: _Schema_Parse_<__Id__>, random: Uint8Array): __Id__ {
  return parseOwn(schema, Array.from(random, (byte) => alphabet.charAt(byte % alphabet.length)).join(""));
}
