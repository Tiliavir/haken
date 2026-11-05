/**
 * Own inline stroke icons: 24 × 24 view box, stroke 1.75, round caps and
 * joins, `currentColor`. Decorative: `aria-hidden`; the button carries the label.
 */
const SVG = "http://www.w3.org/2000/svg";

const PATHS = {
  star: ["M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9L12 3.5Z"],
  calendar: [
    "M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z",
    "M4 10h16",
    "M8 3.5V7",
    "M16 3.5V7",
  ],
  inbox: [
    "M4 13l2.5-7.5h11L20 13",
    "M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5",
    "M4 13h4.5l1 2h5l1-2H20",
  ],
  list: ["M9 7h11", "M9 12h11", "M9 17h11", "M4.5 7h.01", "M4.5 12h.01", "M4.5 17h.01"],
  plus: ["M12 5v14", "M5 12h14"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M19.4 13.5l1.4 1.1-1.8 3.1-1.7-.6a7 7 0 0 1-1.9 1.1l-.3 1.8h-3.6l-.3-1.8a7 7 0 0 1-1.9-1.1l-1.7.6-1.8-3.1 1.4-1.1a7 7 0 0 1 0-3l-1.4-1.1 1.8-3.1 1.7.6a7 7 0 0 1 1.9-1.1l.3-1.8h3.6l.3 1.8a7 7 0 0 1 1.9 1.1l1.7-.6 1.8 3.1-1.4 1.1a7 7 0 0 1 0 3Z",
  ],
  back: ["M15 5l-7 7 7 7"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  grip: ["M9 6h.01", "M15 6h.01", "M9 12h.01", "M15 12h.01", "M9 18h.01", "M15 18h.01"],
  check: ["M6.5 12.5l3.5 3.5 7.5-8"],
  paperclip: [
    "M16.5 8.5l-6.8 6.8a2 2 0 0 1-2.8-2.8l7.2-7.2a3.5 3.5 0 0 1 5 5L11.8 17.6a5 5 0 0 1-7.1-7.1L11 4.2",
  ],
  tag: [
    "M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0L3.5 12.2Z",
    "M8 8h.01",
  ],
  trash: ["M4.5 7h15", "M9.5 7V4.5h5V7", "M6.5 7l.9 12a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-12"],
  alert: ["M12 4 2.8 19.5h18.4L12 4Z", "M12 10v4", "M12 17h.01"],
  merge: ["M7 4v6a5 5 0 0 0 5 5h5", "M14 12l3 3-3 3", "M7 20v-3"],
  download: ["M12 4v11", "M7.5 10.5 12 15l4.5-4.5", "M5 19.5h14"],
  link: [
    "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1",
    "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  ],
  chevron: ["M9 6l6 6-6 6"],
  focus: [
    "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z",
    "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M12 12.01V12",
  ],
  exclaim: ["M12 4.5v10", "M12 19h.01"],
  repeat: [
    "M4.5 11a7.5 7.5 0 0 1 13.2-4.9L19.5 8",
    "M19.5 3.5V8H15",
    "M19.5 13a7.5 7.5 0 0 1-13.2 4.9L4.5 16",
    "M4.5 20.5V16H9",
  ],
  edit: ["M4.5 19.5l1-4L15.8 5.2a2 2 0 0 1 2.8 2.8L8.3 18.3l-3.8 1.2Z"],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = "icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
