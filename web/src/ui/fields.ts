/**
 * Text fields that save without a blur, and add fields that keep their text
 * until the commit succeeded. Both are keyed by name, not by element, because
 * a re-render replaces the elements while the user types.
 */

const DELAY_MS = 500;

interface Pending {
  readonly save: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();
let listening = false;

function flush(key: string): void {
  const p = pending.get(key);
  if (p === undefined) return;
  pending.delete(key);
  clearTimeout(p.timer);
  p.save();
}

/** Saves every typed value now: the page may be about to be hidden or unloaded. */
export function flushAll(): void {
  for (const key of [...pending.keys()]) flush(key);
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
}

/**
 * Saves the field's value on `input` (debounced), on blur, on `pagehide` and
 * when the page is hidden. `save` gets the raw value; `key` identifies the
 * field across re-renders (e.g. task href + property).
 */
export function autosave(
  el: HTMLInputElement | HTMLTextAreaElement,
  key: string,
  save: (value: string) => void,
): void {
  listen();
  el.addEventListener("input", () => {
    const value = el.value;
    const old = pending.get(key);
    if (old !== undefined) clearTimeout(old.timer);
    pending.set(key, { save: () => save(value), timer: setTimeout(() => flush(key), DELAY_MS) });
  });
  el.addEventListener("blur", () => flush(key));
}

const busy = new Set<string>();

/**
 * Submits an add field: `commit` gets the trimmed text; the field (found by
 * `name`, it may have been re-rendered) is cleared only after `commit`
 * succeeded and only if it still holds the submitted text. A failed commit
 * leaves the text in place. A second submit while one is running is ignored.
 */
export async function submitField(
  input: HTMLInputElement,
  commit: (value: string) => Promise<unknown>,
): Promise<void> {
  const name = input.name;
  const raw = input.value;
  const value = raw.trim();
  if (value === "" || busy.has(name)) return;
  busy.add(name);
  try {
    await commit(value);
    const current = document.querySelector<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`);
    if (current !== null && current.value === raw) current.value = "";
  } finally {
    busy.delete(name);
  }
}
