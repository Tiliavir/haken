/**
 * Trusted Types policies (CSP `require-trusted-types-for 'script'`). The app
 * builds its DOM without HTML strings; only two sinks remain: the
 * service-worker URL and parsing CalDAV XML responses (an inert XML document,
 * never inserted or run). Browsers without Trusted Types take the string.
 */
import { HakenError } from "../domain/errors.js";

interface Policy {
  createHTML?(input: string): unknown;
  createScriptURL?(input: string): unknown;
}
interface Factory {
  createPolicy(
    name: string,
    rules: { createHTML?: (s: string) => string; createScriptURL?: (s: string) => string },
  ): Policy;
}

const factory = (globalThis as { trustedTypes?: Factory }).trustedTypes;

const SW_URL = "sw.js";

const swPolicy = factory?.createPolicy("haken-sw", {
  createScriptURL: (url) => {
    if (url !== SW_URL) throw new HakenError("net", "Unexpected service-worker URL", { url });
    return url;
  },
});

const xmlPolicy = factory?.createPolicy("haken-xml", { createHTML: (text) => text });

/** The service-worker script URL. */
export function serviceWorkerUrl(): string {
  return (swPolicy?.createScriptURL?.(SW_URL) ?? SW_URL) as string;
}

/** Parses a CalDAV XML response body. */
export function parseXml(text: string): Document {
  return new DOMParser().parseFromString(
    (xmlPolicy?.createHTML?.(text) ?? text) as string,
    "application/xml",
  );
}
