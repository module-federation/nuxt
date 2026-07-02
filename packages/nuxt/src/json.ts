export type JsonObject = Record<string, unknown>;

export function parseJsonObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: JsonObject, key: string) {
  const property = value[key];
  return typeof property === "string" ? property : undefined;
}

export function readStringRecord(value: JsonObject, key: string) {
  const property = value[key];
  if (!isJsonObject(property)) return undefined;

  return Object.fromEntries(
    Object.entries(property).filter((entry): entry is [string, string] => {
      const [, entryValue] = entry;
      return typeof entryValue === "string";
    }),
  );
}
