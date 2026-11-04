/**
 * Meta database `haken`: accounts and per-device settings
 * ([first start](../../../docs/arc42/adr/ADR-20261103-first-start-setup.md)).
 */
import { InvalidInputError } from "../domain/errors.js";
import { open, request, transact } from "./idb.js";
import { type AccountRecord, SCHEMA, SETUP_STEPS, type SetupStep, toAccount } from "./records.js";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  readonly activeAccount: string | null;
  readonly setupStep: SetupStep | null;
  readonly theme: Theme;
  /** `#rrggbb`; `null` = default accent. */
  readonly accent: string | null;
  /** BCP 47 tag; `null` = system language. */
  readonly locale: string | null;
  readonly installOffered: boolean;
  /** Error tasks created today (`errorDay`, device date) and failures while writing them. */
  readonly errorDay: string;
  readonly errorCount: number;
  readonly errorRecursions: number;
}

export const DEFAULT_SETTINGS: Settings = {
  activeAccount: null,
  setupStep: null,
  theme: "system",
  accent: null,
  locale: null,
  installOffered: false,
  errorDay: "",
  errorCount: 0,
  errorRecursions: 0,
};

type Key = keyof Settings;

const VALIDATORS: { readonly [K in Key]: (v: unknown) => v is Settings[K] } = {
  activeAccount: (v): v is string | null => v === null || typeof v === "string",
  setupStep: (v): v is SetupStep | null =>
    v === null || (typeof v === "string" && (SETUP_STEPS as readonly string[]).includes(v)),
  theme: (v): v is Theme => v === "system" || v === "light" || v === "dark",
  accent: (v): v is string | null =>
    v === null || (typeof v === "string" && /^#[0-9a-f]{6}$/.test(v)),
  locale: (v): v is string | null =>
    v === null || (typeof v === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v)),
  installOffered: (v): v is boolean => typeof v === "boolean",
  errorDay: (v): v is string => typeof v === "string",
  errorCount: (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0,
  errorRecursions: (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0,
};

export class MetaStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<MetaStore> {
    const db = await open("haken", 1, (d, old) => {
      if (old < 1) {
        d.createObjectStore("accounts", { keyPath: "id" });
        d.createObjectStore("settings", { keyPath: "key" });
      }
    });
    return new MetaStore(db);
  }

  async settings(): Promise<Settings> {
    const rows = await transact(this.db, ["settings"], "readonly", (tx) =>
      request(tx.objectStore("settings").getAll()),
    );
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const row of rows as unknown[]) {
      if (typeof row !== "object" || row === null) throw invalidSetting("row");
      const { key, value, schema } = row as { key: unknown; value: unknown; schema: unknown };
      if (schema !== SCHEMA || typeof key !== "string" || !Object.hasOwn(VALIDATORS, key)) {
        throw invalidSetting(String(key));
      }
      const validate = VALIDATORS[key as Key] as (v: unknown) => boolean;
      if (!validate(value)) throw invalidSetting(key);
      out[key] = value;
    }
    return out as unknown as Settings;
  }

  async set<K extends Key>(key: K, value: Settings[K]): Promise<void> {
    if (!VALIDATORS[key](value)) throw invalidSetting(key);
    await transact(this.db, ["settings"], "readwrite", (tx) =>
      request(tx.objectStore("settings").put({ schema: SCHEMA, key, value })),
    );
  }

  async accounts(): Promise<AccountRecord[]> {
    const rows = await transact(this.db, ["accounts"], "readonly", (tx) =>
      request(tx.objectStore("accounts").getAll()),
    );
    return (rows as unknown[]).map(toAccount);
  }

  async account(id: string): Promise<AccountRecord | null> {
    const row: unknown = await transact(this.db, ["accounts"], "readonly", (tx) =>
      request(tx.objectStore("accounts").get(id)),
    );
    return row === undefined ? null : toAccount(row);
  }

  /** Writes an account and optionally activates it, atomically. */
  async putAccount(account: AccountRecord, activate: boolean): Promise<void> {
    toAccount(account);
    await transact(this.db, ["accounts", "settings"], "readwrite", async (tx) => {
      await request(tx.objectStore("accounts").put(account));
      if (activate) {
        await request(
          tx
            .objectStore("settings")
            .put({ schema: SCHEMA, key: "activeAccount", value: account.id }),
        );
      }
    });
  }

  async deleteAccount(id: string): Promise<void> {
    await transact(this.db, ["accounts", "settings"], "readwrite", async (tx) => {
      await request(tx.objectStore("accounts").delete(id));
      const active = (await request(tx.objectStore("settings").get("activeAccount"))) as
        | { value?: unknown }
        | undefined;
      if (active?.value === id) {
        await request(
          tx.objectStore("settings").put({ schema: SCHEMA, key: "activeAccount", value: null }),
        );
      }
    });
  }

  close(): void {
    this.db.close();
  }
}

function invalidSetting(key: string): InvalidInputError {
  return new InvalidInputError("store", "Stored setting has an unexpected value", {
    store: "settings",
    key,
  });
}
