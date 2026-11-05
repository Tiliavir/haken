/** Loads message files through the static loader (ADR-20261103-i18n-json-messages). */
import { InvalidInputError } from "../domain/errors.js";
import { staticJson } from "../net/http.js";

export type Messages = Readonly<Record<string, string>>;

const TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function flatStrings(value: unknown, path: string): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidInputError("app", "Locale file is not an object", { path });
  }
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string")
      throw new InvalidInputError("app", "Locale value is not a string", { path, key: k });
  }
  return value as Record<string, string>;
}

export async function loadIndex(): Promise<Readonly<Record<string, string>>> {
  const index = flatStrings(await staticJson("locales/index.json"), "locales/index.json");
  for (const tag of Object.keys(index)) {
    if (!TAG.test(tag))
      throw new InvalidInputError("app", "Invalid locale tag in index", {
        path: "locales/index.json",
        key: tag,
      });
  }
  return index;
}

export async function loadMessages(tag: string): Promise<Messages> {
  if (!TAG.test(tag)) throw new InvalidInputError("app", "Invalid locale tag", { key: tag });
  const path = `locales/${tag.toLowerCase()}.json`;
  return flatStrings(await staticJson(path), path);
}
