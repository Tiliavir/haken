/**
 * DOM construction without `innerHTML`: elements are created and text is set
 * with `textContent`, so user content and translations can never inject
 * markup. No inline styles; classes only.
 */
import { HakenError } from "../domain/errors.js";

type Child = Node | string | null | false | undefined;

export interface Attrs {
  readonly class?: string;
  readonly [name: string]: string | boolean | number | undefined | ((event: Event) => void);
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: readonly (Child | readonly Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") {
      if (!name.startsWith("on"))
        throw new HakenError("ui", "Handler attribute must start with on", { name });
      el.addEventListener(name.slice(2), value);
      continue;
    }
    if (name === "style") throw new HakenError("ui", "Inline styles are not allowed");
    el.setAttribute(name, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

function append(el: Element, children: readonly (Child | readonly Child[])[]): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      append(el, child);
    } else if (child instanceof Node) {
      el.append(child);
    } else if (typeof child === "string") {
      el.append(document.createTextNode(child));
    }
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

/** Replaces all children; `null`/`false` entries are skipped. */
export function fill(el: Element, ...children: readonly (Child | readonly Child[])[]): void {
  el.replaceChildren();
  append(el, children);
}
