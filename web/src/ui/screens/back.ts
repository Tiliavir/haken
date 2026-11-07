/** Back navigation (chapter 8, Layout): an icon before the title, mobile only. */
import { h } from "../dom.js";
import { t } from "../i18n.js";
import { icon } from "../icons.js";

export function backLink(href: string, parent: string): HTMLElement {
  return h(
    "a",
    { class: "back", href, "aria-label": t("nav.backTo", { name: parent }) },
    icon("back"),
  );
}
