/** Lighten (amount > 0) or darken (amount < 0) a #RRGGBB colour. amount is -1..1. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function isHex(value: string | null | undefined): value is string {
  return !!value && /^#[0-9A-Fa-f]{6}$/.test(value);
}
