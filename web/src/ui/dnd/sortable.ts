/**
 * Drag and drop for manual order (chapter 8): own Pointer Events code, since
 * native HTML5 drag and drop fails on touch. The whole row is the handle:
 * touch lifts it after a hold (a quick swipe scrolls), mouse and pen after a
 * short move (a click opens). This module is the only code allowed to write
 * `style.transform`.
 *
 * Keyboard: Alt+↑ / Alt+↓ on the focused row moves it one place.
 * Every move is announced in the live region; rows carry `data-label`.
 */
import { HakenError } from "../../domain/errors.js";
import { t } from "../i18n.js";
import { announce } from "../live.js";

export type MoveHandler = (href: string, index: number) => void;

/**
 * Drop on an element outside the list marked `data-drop="<target>"` (the
 * sidebar's *Focus*). Keyboard users use the task screen's button instead.
 */
export type DropHandler = (href: string, target: string) => void;

const HOLD_MS = 300;
const TOUCH_SLOP_PX = 8;
const MOUSE_SLOP_PX = 5;
/** Controls inside a row keep their own pointer behaviour. */
const CONTROLS = "button, input, select, textarea, label";

/** The drop target under the pointer, looking past the dragged row (it covers what is below it). */
function dropTargetAt(x: number, y: number, dragged: HTMLElement): HTMLElement | null {
  const below = document.elementsFromPoint(x, y).find((el) => !dragged.contains(el));
  return below?.closest<HTMLElement>("[data-drop]") ?? null;
}

let active = false;

/** True while a drag is in progress; the UI defers re-rendering until it ends. */
export function isDragging(): boolean {
  return active;
}

let onEnd: (() => void) | null = null;

export function onDragEnd(callback: () => void): void {
  onEnd = callback;
}

function finish(): void {
  active = false;
  onEnd?.();
}

function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(":scope > [data-sortable]")];
}

/** The sortable row of `container` that `target` belongs to, unless it is on a control. */
function rowOf(container: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || target.closest(CONTROLS) !== null) return null;
  const row = target.closest<HTMLElement>("[data-sortable]");
  return row?.parentElement === container ? row : null;
}

/** "‹title› moved to position 2 of 5", once the move is handed on. */
function announceMove(row: HTMLElement, index: number, total: number): void {
  const title = row.dataset["label"];
  if (title === undefined) throw new HakenError("ui", "Sortable row without data-label");
  announce(t("move.moved", { title, position: index + 1, total }));
}

/** Swallows the click that follows a drag, so dropping never opens the row. */
function swallowClick(row: HTMLElement): void {
  const stop = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  row.addEventListener("click", stop, { capture: true, once: true });
  // No click follows when the pointer ended elsewhere: drop the guard.
  setTimeout(() => row.removeEventListener("click", stop, { capture: true }), 0);
}

export function makeSortable(
  container: HTMLElement,
  onMove: MoveHandler,
  onDrop?: DropHandler,
): void {
  container.addEventListener("pointerdown", (event) => {
    const row = rowOf(container, event.target);
    if (row === null || event.button !== 0 || !event.isPrimary) return;
    press(container, row, event, onMove, onDrop);
  });
  // A lifted row must not scroll the page or open the native link menu.
  container.addEventListener(
    "touchmove",
    (e) => {
      if (active) e.preventDefault();
    },
    { passive: false },
  );
  container.addEventListener("contextmenu", (e) => {
    if (active) e.preventDefault();
  });
  container.addEventListener("dragstart", (e) => {
    if (rowOf(container, e.target) !== null) e.preventDefault();
  });
  container.addEventListener("keydown", (event) => {
    const row = rowOf(container, event.target);
    if (row === null || !event.altKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const list = rows(container);
    const index = list.indexOf(row) + (event.key === "ArrowUp" ? -1 : 1);
    const href = row.dataset["href"];
    // The re-render shows the stored order; the next press counts from there.
    if (index < 0 || index >= list.length || href === undefined) return;
    onMove(href, index);
    announceMove(row, index, list.length);
  });
}

/** Waits for a hold (touch) or a move (mouse, pen); a release or a scroll before that is a tap. */
function press(
  container: HTMLElement,
  row: HTMLElement,
  start: PointerEvent,
  onMove: MoveHandler,
  onDrop: DropHandler | undefined,
): void {
  const touch = start.pointerType === "touch";
  const cleanup = (): void => {
    clearTimeout(timer);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
  };
  const lift = (): void => {
    cleanup();
    startDrag(container, row, start, onMove, onDrop);
  };
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== start.pointerId) return;
    const distance = Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY);
    if (touch && distance > TOUCH_SLOP_PX) cleanup();
    else if (!touch && distance > MOUSE_SLOP_PX) lift();
  };
  const timer = touch ? setTimeout(lift, HOLD_MS) : undefined;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}

/**
 * Opens the gap at `index` among `others`: rows between the lifted row's own
 * slot and the gap slide by its height (CSS transitions the slide).
 */
function openGap(others: readonly HTMLElement[], originalIndex: number, index: number): void {
  for (const [i, r] of others.entries()) {
    r.classList.toggle("shift-up", i >= originalIndex && i < index);
    r.classList.toggle("shift-down", i >= index && i < originalIndex);
  }
}

function startDrag(
  container: HTMLElement,
  row: HTMLElement,
  start: PointerEvent,
  onMove: MoveHandler,
  onDrop: DropHandler | undefined,
): void {
  active = true;
  row.setPointerCapture(start.pointerId);
  const others = rows(container).filter((r) => r !== row);
  const originalIndex = rows(container).indexOf(row);
  // Midpoints before anything slides: the gap must not chase the pointer.
  const middles = others.map((r) => {
    const rect = r.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  container.style.setProperty("--drag-gap", `${row.getBoundingClientRect().height}px`);
  container.classList.add("sorting");
  row.classList.add("dragging");
  let index = originalIndex;
  let target: HTMLElement | null = null;

  const place = (clientX: number, clientY: number): void => {
    const dy = clientY - start.clientY;
    const dx = onDrop === undefined ? 0 : clientX - start.clientX;
    row.style.transform = `translate(${dx}px, ${dy}px) rotate(-1deg)`;
    const over = onDrop === undefined ? null : dropTargetAt(clientX, clientY, row);
    if (over !== target) {
      target?.classList.remove("drop-target");
      over?.classList.add("drop-target");
      target = over;
    }
    index = target === null ? middles.filter((m) => m < clientY).length : originalIndex;
    openGap(others, originalIndex, index);
  };
  place(start.clientX, start.clientY);

  const move = (e: PointerEvent): void => place(e.clientX, e.clientY);
  const end = (e: PointerEvent): void => {
    row.removeEventListener("pointermove", move);
    row.removeEventListener("pointerup", end);
    row.removeEventListener("pointercancel", end);
    swallowClick(row);
    const href = row.dataset["href"];
    const dropped = target?.dataset["drop"];
    target?.classList.remove("drop-target");
    const up = e.type === "pointerup" && href !== undefined;
    const reorder = up && dropped === undefined && index !== originalIndex;
    // Into the gap at once, so nothing slides back before the re-render.
    const next = index < others.length ? others[index] : others.at(-1)?.nextElementSibling;
    if (reorder) container.insertBefore(row, next ?? null);
    container.classList.remove("sorting");
    container.style.removeProperty("--drag-gap");
    openGap(others, 0, 0);
    row.classList.remove("dragging");
    row.style.transform = "";
    finish();
    if (up && dropped !== undefined && onDrop !== undefined) onDrop(href, dropped);
    else if (reorder) {
      onMove(href, index);
      announceMove(row, index, others.length + 1);
    }
  };
  row.addEventListener("pointermove", move);
  row.addEventListener("pointerup", end);
  row.addEventListener("pointercancel", end);
}
