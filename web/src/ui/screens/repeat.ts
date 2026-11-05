/** The *Repeat* row of the task screen and the short rule text in list rows. */
import type { TaskItem } from "../../app/service.js";
import {
  type Frequency,
  NEVER,
  type Nth,
  type Recurrence,
  type RecurrenceEnd,
  WEEKDAYS,
  type Weekday,
} from "../../domain/recurrence.js";
import type { TaskView } from "../../domain/vtodo.js";
import type { Ctx } from "../context.js";
import { h } from "../dom.js";
import { formatDate, type Key, t, tp } from "../i18n.js";
import { icon } from "../icons.js";
import { dueDate, localDate } from "../views.js";

type Choice = "never" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";
type Preset = Exclude<Choice, "never" | "custom">;

const WORKDAYS: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR"];
const base = { byDay: [], monthlyNth: null, end: NEVER } as const;
const PRESETS: Readonly<Record<Preset, Recurrence>> = {
  daily: { ...base, freq: "DAILY", interval: 1 },
  weekdays: { ...base, freq: "WEEKLY", interval: 1, byDay: WORKDAYS },
  weekly: { ...base, freq: "WEEKLY", interval: 1 },
  monthly: { ...base, freq: "MONTHLY", interval: 1 },
  yearly: { ...base, freq: "YEARLY", interval: 1 },
};

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && a.every((d) => b.includes(d));
}

/** The preset a rule matches, ignoring its end; `custom` otherwise. */
export function choiceOf(rule: Recurrence | null): Choice {
  if (rule === null) return "never";
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (
      preset.freq === rule.freq &&
      preset.interval === rule.interval &&
      sameDays(preset.byDay, rule.byDay) &&
      rule.monthlyNth === null
    ) {
      return name as Choice;
    }
  }
  return "custom";
}

/** Short weekday name, Monday-based (1 January 2024 was a Monday). */
export function weekdayName(day: Weekday, style: "short" | "long" = "short"): string {
  return formatDate(new Date(2024, 0, 1 + WEEKDAYS.indexOf(day), 12), { weekday: style });
}

const NTH_KEYS: Readonly<Record<string, Key>> = {
  "1": "repeat.nth1",
  "2": "repeat.nth2",
  "3": "repeat.nth3",
  "4": "repeat.nth4",
  "-1": "repeat.nthLast",
};

function nthText(nth: Nth, day: Weekday): string {
  return t("repeat.onNth", {
    nth: t(NTH_KEYS[String(nth)] as Key),
    weekday: weekdayName(day, "long"),
  });
}

function endText(end: RecurrenceEnd): string | null {
  if (end.kind === "count") return tp("repeat.timesLeft", end.count);
  if (end.kind === "until") {
    const [y, m, d] = end.date.split("-").map(Number) as [number, number, number];
    return t("repeat.until", {
      date: formatDate(new Date(y, m - 1, d, 12), {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    });
  }
  return null;
}

/** "Weekly", "Every 2 weeks · Mon, Thu", "Monthly · on the second Tuesday · 3 times left". */
export function describeRule(rule: Recurrence): string {
  const choice = choiceOf(rule);
  const every =
    choice !== "custom" && choice !== "never"
      ? choiceLabel(choice)
      : rule.freq === "DAILY"
        ? tp("repeat.everyDay", rule.interval)
        : rule.freq === "WEEKLY"
          ? tp("repeat.everyWeek", rule.interval)
          : rule.freq === "MONTHLY"
            ? tp("repeat.everyMonth", rule.interval)
            : tp("repeat.everyYear", rule.interval);
  const parts = [every];
  if (choice === "custom" && rule.byDay.length > 0)
    parts.push(rule.byDay.map((d) => weekdayName(d)).join(", "));
  if (rule.monthlyNth !== null) parts.push(nthText(rule.monthlyNth.nth, rule.monthlyNth.day));
  const end = endText(rule.end);
  if (end !== null) parts.push(end);
  return parts.join(" · ");
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

/** The ordinal weekday of a date: the 9th of a month is its second weekday of that kind; the last seven days are also "last". */
export function nthOf(date: string): { nth: Nth; day: Weekday; last: boolean } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = WEEKDAYS[(new Date(y, m - 1, d).getDay() + 6) % 7] as Weekday;
  const nth = Math.ceil(d / 7);
  const last = d + 7 > new Date(y, m, 0).getDate();
  return { nth: nth >= 5 ? -1 : (nth as Nth), day, last };
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
        // A preset keeps the end the user already set.
        save(value === "never" ? null : { ...PRESETS[value], end: rule?.end ?? NEVER });
      },
    },
    choices.map((c) => h("option", { value: c, selected: c === choice }, choiceLabel(c))),
  );
  const due = view.due === null ? localDate(ctx.now) : dueDate(view.due);
  const current = rule ?? PRESETS.weekly;
  return h(
    "div",
    { class: "group-row wrap repeat" },
    icon("repeat"),
    h("label", { for: "repeat-select", class: "row-label" }, t("repeat.title")),
    select,
    choice === "custom" ? customEditor(item, current, due, save) : null,
    rule === null ? null : endEditor(rule, due, save),
  );
}

function customEditor(
  item: TaskItem,
  rule: Recurrence,
  due: string,
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
        save({ ...rule, freq, byDay: freq === "WEEKLY" ? rule.byDay : [], monthlyNth: null });
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
    rule.freq === "MONTHLY" ? monthlyChoice(rule, due, save) : null,
  );
}

/** Monthly: on the due date's day of the month, or on its ordinal weekday ("the second Tuesday", "the last Friday"). */
function monthlyChoice(rule: Recurrence, due: string, save: (r: Recurrence) => void): HTMLElement {
  const { nth, day, last } = nthOf(due);
  const options: { id: string; label: string; value: Recurrence["monthlyNth"] }[] = [
    { id: "monthly-day", label: t("repeat.onDay", { day: Number(due.slice(8, 10)) }), value: null },
  ];
  if (nth !== -1)
    options.push({ id: "monthly-nth", label: nthText(nth, day), value: { nth, day } });
  if (last) options.push({ id: "monthly-last", label: nthText(-1, day), value: { nth: -1, day } });
  const current = rule.monthlyNth;
  return h(
    "fieldset",
    { class: "choice-list" },
    h("legend", { class: "visually-hidden" }, t("repeat.on")),
    options.map((o) =>
      h(
        "label",
        { class: "radio-row" },
        h("input", {
          type: "radio",
          name: "monthly",
          id: o.id,
          checked:
            o.value === null
              ? current === null
              : current !== null && current.nth === o.value.nth && current.day === o.value.day,
          onchange: () => save({ ...rule, monthlyNth: o.value }),
        }),
        h("span", {}, o.label),
      ),
    ),
  );
}

/** Ends: never, after N times (occurrences left), or on a date. */
function endEditor(rule: Recurrence, due: string, save: (r: Recurrence) => void): HTMLElement {
  const end = rule.end;
  const kind = h(
    "select",
    {
      id: "repeat-end",
      onchange: (e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        if (value === "never") save({ ...rule, end: NEVER });
        if (value === "count") save({ ...rule, end: { kind: "count", count: 10 } });
        if (value === "until") save({ ...rule, end: { kind: "until", date: due } });
      },
    },
    h("option", { value: "never", selected: end.kind === "never" }, t("repeat.endsNever")),
    h("option", { value: "count", selected: end.kind === "count" }, t("repeat.endsAfter")),
    h("option", { value: "until", selected: end.kind === "until" }, t("repeat.endsOn")),
  );
  const detail =
    end.kind === "count"
      ? h("input", {
          id: "repeat-count",
          type: "number",
          min: "1",
          max: "999",
          step: "1",
          inputmode: "numeric",
          class: "interval-input",
          "aria-label": t("repeat.times"),
          value: String(end.count),
          onchange: (e: Event) => {
            const n = Number((e.target as HTMLInputElement).value);
            if (Number.isInteger(n) && n >= 1 && n <= 999)
              save({ ...rule, end: { kind: "count", count: n } });
          },
        })
      : end.kind === "until"
        ? h("input", {
            id: "repeat-until",
            type: "date",
            min: due,
            "aria-label": t("repeat.endsOn"),
            value: end.date,
            onchange: (e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) save({ ...rule, end: { kind: "until", date: v } });
            },
          })
        : null;
  return h(
    "div",
    { class: "repeat-custom" },
    h("label", { for: "repeat-end" }, t("repeat.ends")),
    kind,
    detail,
    end.kind === "count" ? h("span", { class: "muted" }, t("repeat.times")) : null,
  );
}
