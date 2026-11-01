const width = 100;

function inline(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${value.map(inline).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([key, entry]) => `${JSON.stringify(key)}: ${inline(entry)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

// JSON for people to read: whatever fits on a line stays on one
export function printJson(value: unknown, indent = "", taken = 0): string {
  const short = inline(value);
  if (typeof value !== "object" || value === null || indent.length + taken + short.length <= width) return short;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${printJson(item, inner)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).map(([key, entry]) => {
    const label = `${JSON.stringify(key)}: `;
    return `${inner}${label}${printJson(entry, inner, label.length)}`;
  });
  return `{\n${entries.join(",\n")}\n${indent}}`;
}
