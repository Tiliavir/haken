/**
 * Theming (ADR-20261103-theming): appearance override and a contrast-safe
 * custom accent. The colour functions are pure and unit tested; `applyTheme`
 * writes a constructed stylesheet (no inline styles, CSP-compatible).
 */
import { HakenError } from "../domain/errors.js";

export const DEFAULT_ACCENT = "#1f4d45";
const DEFAULT_DARK = "#618f86";

const LIGHT_BACKGROUNDS = ["#ffffff", "#f5f6f7"];
const DARK_BACKGROUNDS = ["#121416", "#1c1f22"];
/** `--bg` per scheme, for `<meta name="theme-color">`. */
export const PAGE_BACKGROUND = { light: "#ffffff", dark: "#121416" } as const;

type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new HakenError("ui", "Not a #rrggbb colour", { value: hex });
  return [
    Number.parseInt(m[1] ?? "", 16) / 255,
    Number.parseInt(m[2] ?? "", 16) / 255,
    Number.parseInt(m[3] ?? "", 16) / 255,
  ];
}

export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Oklch = readonly [number, number, number];

export function toOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(lin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function fromOklchRaw(lch: Oklch): [number, number, number] {
  const [L, C, H] = lch;
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH to sRGB; out-of-gamut colours lose chroma until they fit. */
export function fromOklch(lch: Oklch): Rgb {
  let [L, C, H] = lch;
  L = Math.min(1, Math.max(0, L));
  for (let i = 0; i < 40; i++) {
    const rgb = fromOklchRaw([L, C, H]);
    if (rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4)) return rgb.map(gam) as unknown as Rgb;
    C *= 0.9;
  }
  return fromOklchRaw([L, 0, H]).map(gam) as unknown as Rgb;
}

/** Moves lightness (darker for light schemes, lighter for dark ones) until 4.5:1 against every background. */
export function adjustForContrast(
  hex: string,
  backgrounds: readonly string[],
  direction: "darker" | "lighter",
): string {
  const ok = (c: string): boolean => backgrounds.every((bg) => contrast(c, bg) >= 4.5);
  if (ok(hex)) return hex.toLowerCase();
  const [L0, C, H] = toOklch(parseHex(hex));
  const step = direction === "darker" ? -0.005 : 0.005;
  for (let L = L0; L >= 0 && L <= 1; L += step) {
    const candidate = toHex(fromOklch([L, C, H]));
    if (ok(candidate)) return candidate;
  }
  return direction === "darker" ? "#000000" : "#ffffff";
}

export interface Accent {
  readonly light: string;
  readonly dark: string;
  readonly onLight: string;
  readonly onDark: string;
}

/** Black or white, whichever contrasts more with the fill. */
export function onColour(fill: string): string {
  return contrast(fill, "#000000") >= contrast(fill, "#ffffff") ? "#000000" : "#ffffff";
}

export function deriveAccent(hex: string): Accent {
  const base = hex.toLowerCase();
  parseHex(base);
  const light =
    base === DEFAULT_ACCENT ? DEFAULT_ACCENT : adjustForContrast(base, LIGHT_BACKGROUNDS, "darker");
  const dark =
    base === DEFAULT_ACCENT ? DEFAULT_DARK : adjustForContrast(base, DARK_BACKGROUNDS, "lighter");
  return { light, dark, onLight: onColour(light), onDark: onColour(dark) };
}

export type Appearance = "system" | "light" | "dark";

let sheet: CSSStyleSheet | null = null;

export function applyTheme(appearance: Appearance, accentHex: string | null): void {
  const root = document.documentElement;
  if (appearance === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = appearance;
  const accent = deriveAccent(accentHex ?? DEFAULT_ACCENT);
  if (sheet === null) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(
    `:root{--accent:light-dark(${accent.light},${accent.dark});--on-accent:light-dark(${accent.onLight},${accent.onDark});}`,
  );
  const dark =
    appearance === "dark" ||
    (appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta === null) throw new HakenError("ui", "theme-color meta element missing");
  meta.setAttribute("content", dark ? PAGE_BACKGROUND.dark : PAGE_BACKGROUND.light);
}
