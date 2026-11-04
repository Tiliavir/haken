/**
 * Drag and drop for manual order (chapter 8): own Pointer Events code, since
 * native HTML5 drag and drop fails on touch. Dragging starts only from the
 * grip. This module is the only code allowed to write `style.transform`.
 *
 * Keyboard: focus the grip, ↑/↓ move, Enter or Space drop, Esc cancel.
 */

export type MoveHandler = (href: string, index: number) => void;

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

export function makeSortable(container: HTMLElement, onMove: MoveHandler): void {
  container.addEventListener("pointerdown", (event) => {
    const grip = (event.target as Element | null)?.closest(".grip");
    if (!(grip instanceof HTMLElement) || event.button !== 0) return;
    const row = grip.closest<HTMLElement>("[data-sortable]");
    if (row === null || row.parentElement !== container) return;
    event.preventDefault();
    startPointerDrag(container, row, grip, event, onMove);
  });
  container.addEventListener("keydown", (event) => {
    const grip = (event.target as Element | null)?.closest(".grip");
    if (!(grip instanceof HTMLElement)) return;
    const row = grip.closest<HTMLElement>("[data-sortable]");
    if (row === null || row.parentElement !== container) return;
    handleKey(container, row, grip, event, onMove);
  });
}

function startPointerDrag(
  container: HTMLElement,
  row: HTMLElement,
  grip: HTMLElement,
  start: PointerEvent,
  onMove: MoveHandler,
): void {
  active = true;
  grip.setPointerCapture(start.pointerId);
  const others = rows(container).filter((r) => r !== row);
  const originalIndex = rows(container).indexOf(row);
  const line = document.createElement("div");
  line.className = "drop-line";
  line.setAttribute("aria-hidden", "true");
  container.append(line);
  row.classList.add("dragging");
  const containerTop = container.getBoundingClientRect().top;
  let index = originalIndex;

  const place = (clientY: number): void => {
    const dy = clientY - start.clientY;
    row.style.transform = `translateY(${dy}px) rotate(-1deg)`;
    index = others.filter((r) => {
      const rect = r.getBoundingClientRect();
      return rect.top + rect.height / 2 < clientY;
    }).length;
    const ref = others[index - 1];
    const y =
      ref === undefined
        ? (others[0]?.getBoundingClientRect().top ?? containerTop) - containerTop
        : ref.getBoundingClientRect().bottom - containerTop;
    line.style.transform = `translateY(${y}px)`;
  };
  place(start.clientY);

  const move = (e: PointerEvent): void => place(e.clientY);
  const end = (e: PointerEvent): void => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    row.classList.remove("dragging");
    row.style.transform = "";
    line.remove();
    const href = row.dataset["href"];
    const moved = e.type === "pointerup" && index !== originalIndex && href !== undefined;
    finish();
    if (moved) onMove(href, index);
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

interface KeyState {
  readonly row: HTMLElement;
  readonly originalIndex: number;
}

let keyState: KeyState | null = null;

function handleKey(
  container: HTMLElement,
  row: HTMLElement,
  grip: HTMLElement,
  event: KeyboardEvent,
  onMove: MoveHandler,
): void {
  const list = rows(container);
  const index = list.indexOf(row);
  switch (event.key) {
    case "ArrowUp":
    case "ArrowDown": {
      event.preventDefault();
      if (keyState === null || keyState.row !== row) {
        keyState = { row, originalIndex: index };
        active = true;
        row.classList.add("dragging");
      }
      const target = event.key === "ArrowUp" ? index - 1 : index + 1;
      if (target < 0 || target >= list.length) return;
      const ref = event.key === "ArrowUp" ? list[target] : list[target]?.nextElementSibling;
      container.insertBefore(row, ref ?? null);
      grip.focus();
      return;
    }
    case "Enter":
    case " ": {
      if (keyState === null || keyState.row !== row) return;
      event.preventDefault();
      const original = keyState.originalIndex;
      keyState = null;
      row.classList.remove("dragging");
      const href = row.dataset["href"];
      finish();
      if (index !== original && href !== undefined) onMove(href, index);
      return;
    }
    case "Escape": {
      if (keyState === null || keyState.row !== row) return;
      event.preventDefault();
      const original = keyState.originalIndex;
      keyState = null;
      row.classList.remove("dragging");
      const rest = rows(container).filter((r) => r !== row);
      container.insertBefore(row, rest[original] ?? null);
      grip.focus();
      finish();
      return;
    }
    default:
      return;
  }
}
