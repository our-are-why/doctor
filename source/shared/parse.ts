import type { _NonEmpty_ } from "./list.ts";

// the part of the Standard Schema interface parsing uses, so any library
// implementing the standard can stand behind it
export interface _Schema_Parse_<__Value__> {
  readonly "~standard": {
    readonly validate: (
      input: unknown,
    ) => _Outcome_Schema_<__Value__> | Promise<_Outcome_Schema_<__Value__>>;
  };
}

type _Outcome_Schema_<__Value__> = _SUCCESS_Outcome__Schema_<__Value__> | _FAILURE_Outcome__Schema_;

interface _SUCCESS_Outcome__Schema_<__Value__> {
  readonly value: __Value__;
}

interface _FAILURE_Outcome__Schema_ {
  readonly issues: ReadonlyArray<{ readonly message: string }>;
}

export type _Result_Parse_<__Value__> = _PARSED_Result__Parse_<__Value__> | _REJECTED_Result__Parse_;

interface __BASE_Result__Parse_<__ResultKind__ extends string> {
  kind: __ResultKind__;
}

export interface _PARSED_Result__Parse_<__Value__> extends __BASE_Result__Parse_<"parsed"> {
  value: __Value__;
}

export interface _REJECTED_Result__Parse_ extends __BASE_Result__Parse_<"rejected"> {
  issues: _NonEmpty_<string>;
}

export function parse<__Value__>(
  schema: _Schema_Parse_<__Value__>,
  input: unknown,
): _Result_Parse_<__Value__> {
  const outcome = schema["~standard"].validate(input);
  if (outcome instanceof Promise) {
    return { kind: "rejected", issues: ["the schema is asynchronous, and parsing is synchronous"] };
  }
  if ("value" in outcome) {
    return { kind: "parsed", value: outcome.value };
  }
  const [first, ...rest] = outcome.issues.map((issue) => issue.message);
  return { kind: "rejected", issues: [first ?? "rejected without a reason", ...rest] };
}

// for values whose failing parse is a bug, not bad input: what doctor itself
// makes, checked through the same schema anything from outside would be
export function parseOwn<__Value__>(schema: _Schema_Parse_<__Value__>, input: unknown): __Value__ {
  const result = parse(schema, input);
  if (result.kind === "rejected") {
    throw new Error(`doctor made a value its own schema rejects: ${result.issues.join("; ")}`);
  }
  return result.value;
}
