/**
 * Strict error handling (ADR-20261104-strict-errors).
 *
 * `HakenError` is thrown for every unexpected situation. Its context holds
 * what is needed to analyse it (UIDs, paths, status codes, property names
 * and values), never credentials (ADR-20261104-error-task-content). The
 * error-task writer in `app/errors.ts` copies it into the task description.
 */

export type Layer = "domain" | "store" | "net" | "sync" | "app" | "ui" | "sw" | "main";

export type ContextValue = string | number | boolean | readonly string[];

export type ErrorContext = Readonly<Record<string, ContextValue>>;

export class HakenError extends Error {
  override readonly name: string = "HakenError";
  readonly layer: Layer;
  readonly context: ErrorContext;

  constructor(layer: Layer, message: string, context: ErrorContext = {}, options?: ErrorOptions) {
    super(message, options);
    this.layer = layer;
    this.context = context;
  }
}

/**
 * Input that does not match an explicit expectation. Thrown by validators at
 * the boundary where the input enters (server response, import, IndexedDB
 * record, config file).
 */
export class InvalidInputError extends HakenError {
  override readonly name: string = "InvalidInputError";
}

export function assert(
  condition: unknown,
  layer: Layer,
  message: string,
  context: ErrorContext = {},
): asserts condition {
  if (!condition) {
    throw new HakenError(layer, message, context);
  }
}

/** Exhaustiveness check for discriminated unions. */
export function unreachable(value: never, layer: Layer): never {
  throw new HakenError(layer, "Unreachable case reached", { value: String(value) });
}
