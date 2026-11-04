/** The *Repeat* row of the task screen and the short rule text in list rows. */
import type { TaskItem } from "../../app/service.js";
import {
  type Frequency,
  type Recurrence,
  WEEKDAYS,
  type Weekday,
} from "../../domain/recurrence.js";
import type { TaskView } from "../../domain/vtodo.js";
import type { Ctx } from "../context.js";
import { h } from "../dom.js";
import { formatDate, t, tp } from "../i18n.js";
import { icon } from "../icons.js";
import { localDate } from "../views.js";

type Choice = "never" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";

const WORKDAYS: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR"];
const PRESETS: Readonly<Record<Exclude<Choice, "never" | "custom">, Recurrence>> = {
  daily: { freq: "DAILY", interval: 1, byDay: [] },
  weekdays: { freq: "WEEKLY", interval: 1, byDay: WORKDAYS },
  weekly: { freq: "WEEKLY", interval: 1, byDay: [] },
  monthly: { freq: "MONTHLY", interval: 1, byDay: [] },
  yearly: { freq: "YEARLY", interval: 1, byDay: [] },
};

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && a.every((d) => b.includes(d));
}

export function choiceOf(rule: Recurrence | null): Choice {
  if (rule === null) return "never";
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (
      preset.freq === rule.freq &&
      preset.interval === rule.interval &&
      sameDays(preset.byDay, rule.byDay)
    ) {
      return name as Choice;
    }
  }
  return "custom";
}

/** Short weekday name, Monday-based (1 January 2024 was a Monday). */
export function weekdayName(day: Weekday): string {
  return formatDate(new Date(2024, 0, 1 + WEEKDAYS.indexOf(day), 12), { weekday: "short" });
}

/** "Weekly", "Every 2 weeks · Mon, Thu", "Weekdays". */
export function describeRule(rule: Recurrence): string {
  const choice = choiceOf(rule);
  if (choice !== "custom" && choice !== "never") return choiceLabel(choice);
  const every =
    rule.freq === "DAILY"
      ? tp("repeat.everyDay", rule.interval)
      : rule.freq === "WEEKLY"
        ? tp("repeat.everyWeek", rule.interval)
        : rule.freq === "MONTHLY"
          ? tp("repeat.everyMonth", rule.interval)
          : tp("repeat.everyYear", rule.interval);
  return rule.byDay.length === 0 ? every : `${every} · ${rule.byDay.map(weekdayName).join(", ")}`;
}

function choiceLabel(choice: Choice): string {
  switch (choice) {
    case "never":
      return t("repeat.never");
    case "daily":
      return t("repeat.daily");
    case "weekdays":
      return t("repeat.weekdays");
    case "weekly":
      return t("repeat.weekly");
    case "monthly":
      return t("repeat.monthly");
    case "yearly":
      return t("repeat.yearly");
    case "custom":
      return t("repeat.custom");
  }
}

function unitLabel(freq: Frequency, count: number): string {
  switch (freq) {
    case "DAILY":
      return tp("repeat.unitDay", count);
    case "WEEKLY":
      return tp("repeat.unitWeek", count);
    case "MONTHLY":
      return tp("repeat.unitMonth", count);
    case "YEARLY":
      return tp("repeat.unitYear", count);
  }
}

/** Hrefs whose custom editor is open although the rule is still a preset (screen-local state). */
const customOpen = new Set<string>();

export function repeatRow(ctx: Ctx, item: TaskItem, view: TaskView): HTMLElement {
  const rule = view.recurrence;
  const choice = customOpen.has(item.href) ? "custom" : choiceOf(rule);
  const save = (value: Recurrence | null): void =>
    ctx.run("ui.editRecurrence", () =>
      ctx.app.edit(item.href, { kind: "recurrence", value, today: localDate(ctx.now) }),
    );
  const choices: readonly Choice[] = [
    "never",
    "daily",
    "weekdays",
    "weekly",
    "monthly",
    "yearly",
    "custom",
  ];
  const select = h(
    "select",
    {
      id: "repeat-select",
      onchange: (e: Event) => {
        const value = (e.target as HTMLSelectElement).value as Choice;
        if (value === "custom") {
          customOpen.add(item.href);
          ctx.rerender();
          return;
        }
        customOpen.delete(item.href);
        save(value === "never" ? null : PRESETS[value]);
      },
    },
    choices.map((c) => h("option", { value: c, selected: c === choice }, choiceLabel(c))),
  );
  return h(
    "div",
    { class: "group-row wrap repeat" },
    icon("repeat"),
    h("label", { for: "repeat-select", class: "row-label" }, t("repeat.title")),
    select,
    choice === "custom" ? customEditor(item, rule ?? PRESETS.weekly, save) : null,
  );
}

function customEditor(
  item: TaskItem,
  rule: Recurrence,
  save: (r: Recurrence) => void,
): HTMLElement {
  const interval = h("input", {
    id: "repeat-interval",
    type: "number",
    min: "1",
    max: "999",
    step: "1",
    value: String(rule.interval),
    inputmode: "numeric",
    class: "interval-input",
    onchange: (e: Event) => {
      const n = Number((e.target as HTMLInputElement).value);
      if (!Number.isInteger(n) || n < 1 || n > 999) return;
      save({ ...rule, interval: n });
    },
  });
  const freqs: readonly Frequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
  const unit = h(
    "select",
    {
      "aria-label": t("repeat.unit"),
      onchange: (e: Event) => {
        const freq = (e.target as HTMLSelectElement).value as Frequency;
        save({ freq, interval: rule.interval, byDay: freq === "WEEKLY" ? rule.byDay : [] });
      },
    },
    freqs.map((f) =>
      h("option", { value: f, selected: f === rule.freq }, unitLabel(f, rule.interval)),
    ),
  );
  const days =
    rule.freq === "WEEKLY"
      ? h(
          "fieldset",
          { class: "weekdays" },
          h("legend", {}, t("repeat.on")),
          WEEKDAYS.map((d) =>
            h(
              "label",
              { class: "weekday" },
              h("input", {
                type: "checkbox",
                value: d,
                checked: rule.byDay.includes(d),
                onchange: (e: Event) => {
                  const on = (e.target as HTMLInputElement).checked;
                  const byDay = on ? [...rule.byDay, d] : rule.byDay.filter((x) => x !== d);
                  save({ ...rule, byDay: WEEKDAYS.filter((w) => byDay.includes(w)) });
                },
              }),
              h("span", {}, weekdayName(d)),
            ),
          ),
        )
      : null;
  return h(
    "div",
    { class: "repeat-custom", "data-href": item.href },
    h("label", { for: "repeat-interval" }, t("repeat.interval")),
    interval,
    unit,
    days,
  );
}
