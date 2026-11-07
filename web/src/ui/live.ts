/**
 * One polite live region for screen readers. It sits outside the re-rendered
 * tree (`<haken-app>` attaches it once), so a re-render never cuts off an
 * announcement.
 */
import { HakenError } from "../domain/errors.js";
import { h } from "./dom.js";

let region: HTMLElement | null = null;

export function liveRegion(): HTMLElement {
  region ??= h("div", { class: "visually-hidden", role: "status", "aria-live": "polite" });
  return region;
}

/** A new node each time: the same text twice in a row is announced twice. */
export function announce(text: string): void {
  if (region?.isConnected !== true) throw new HakenError("ui", "Live region is not attached");
  region.replaceChildren(h("p", {}, text));
}
