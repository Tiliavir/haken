/**
 * Turns unexpected errors into tasks in the list "errorlogs"
 * (ADR-20261104-strict-errors, ADR-20261104-error-task-content): the
 * context of a `HakenError` and a few environment facts. Task values may be
 * included; credentials and query strings never.
 */

import { HakenError } from "../domain/errors.js";
import { ERRORLOGS, type ErrorReport, fingerprint } from "../domain/errortask.js";

/** `version` from package.json, stamped by tools/build.mjs. */
export const APP_VERSION = "__HAKEN_VERSION__";

export interface ErrorSink {
  /** Writes (creates or bumps) the error task. Returns `false` if the daily limit is reached. */
  writeErrorTask(report: ErrorReport, print: string): Promise<boolean>;
  /** Counts a failure while writing an error task (meta database). */
  countRecursion(): Promise<void>;
  environment(): Readonly<Record<string, string | number | boolean>>;
}

const SECRET_KEY = /pass|auth|cookie|token|session|secret/i;

/** Builds the report. Context values that could carry credentials are dropped. */
export function buildReport(
  error: unknown,
  operation: string,
  env: Readonly<Record<string, string | number | boolean>>,
): ErrorReport {
  const err = error instanceof Error ? error : new Error(`Non-error thrown: ${typeof error}`);
  const layer = err instanceof HakenError ? err.layer : "app";
  const details: string[] = [`Operation: ${operation}`];
  if (err instanceof HakenError) {
    for (const [key, value] of Object.entries(err.context)) {
      if (SECRET_KEY.test(key)) continue;
      const text = Array.isArray(value) ? value.join(", ") : String(value);
      details.push(`${key}: ${stripQuery(text)}`);
    }
  }
  for (const [key, value] of Object.entries(env)) details.push(`${key}: ${String(value)}`);
  if (err.cause instanceof Error)
    details.push(`Cause: ${err.cause.name}: ${stripQuery(err.cause.message)}`);
  return {
    name: err.name,
    message: stripQuery(err.message),
    layer,
    details,
    stack: stripQuery(err.stack ?? "(no stack)"),
  };
}

function stripQuery(text: string): string {
  return text.replace(/(https?:\/\/[^\s?#]*)[?#][^\s)]*/g, "$1");
}

export class ErrorReporter {
  private writing = false;

  constructor(private readonly sink: ErrorSink) {}

  /** Never throws: an error while reporting goes to the console and is counted. */
  async report(error: unknown, operation: string): Promise<void> {
    console.error(`[haken] ${operation}`, error);
    if (this.writing) {
      await this.sink.countRecursion();
      return;
    }
    this.writing = true;
    try {
      const report = buildReport(error, operation, this.sink.environment());
      await this.sink.writeErrorTask(
        report,
        fingerprint(report.name, report.message, report.stack),
      );
    } catch (failure) {
      console.error(`[haken] could not write error task to ${ERRORLOGS}`, failure);
      await this.sink
        .countRecursion()
        .catch((e: unknown) => console.error("[haken] recursion counter", e));
    } finally {
      this.writing = false;
    }
  }
}
