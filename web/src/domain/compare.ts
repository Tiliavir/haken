/** Orders strings by UTF-16 code unit: deterministic and independent of the locale. */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
