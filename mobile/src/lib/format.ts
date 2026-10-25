import { API_URL } from './config';

/** 1234567.5 -> "₹12,34,567.50" (Indian digit grouping, no Intl dependency). */
export function inr(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const [whole, frac] = Math.abs(amount).toFixed(2).split('.');
  let grouped = whole;
  if (whole.length > 3) {
    const tail = whole.slice(-3);
    let head = whole.slice(0, -3);
    const groups: string[] = [];
    while (head.length > 2) {
      groups.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) groups.unshift(head);
    grouped = `${groups.join(',')},${tail}`;
  }
  return `${sign}₹${grouped}${frac === '00' ? '' : `.${frac}`}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dateTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = `${d.getMinutes()}`.padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Photos come back as "/media/..." paths; the phone needs the full server address. */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith('http') ? path : `${API_URL}${path}`;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  active: 'Active',
  blocked: 'Blocked',
};

export function packLabel(name: string, pieces: number): string {
  if (pieces === 1 || name.includes(String(pieces))) return name;
  return `${name} (${pieces} pcs)`;
}

/** MRP for a whole pack and the % saved against it (MRP is per piece). Null when there's no saving. */
export function saving(mrpPerPiece: number | null, price: number, pieces: number): { mrp: number; percent: number } | null {
  if (!mrpPerPiece) return null;
  const mrp = mrpPerPiece * pieces;
  const percent = Math.round(((mrp - price) / mrp) * 100);
  return percent >= 1 ? { mrp, percent } : null;
}

/** 'Box (60)' -> 'Box of 60', 'Piece' -> 'Piece'. */
export function packName(name: string, pieces: number): string {
  const base = name.replace(/\s*\(\d+\)\s*$/, '');
  return pieces > 1 ? `${base} of ${pieces}` : base;
}

/** "just now", "12m ago", "3h ago", "2d ago" - for how long an order has been waiting. */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function hoursSince(iso: string, now = Date.now()): number {
  return (now - new Date(iso).getTime()) / 3600000;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** ₹1.2L / ₹45K / ₹900 for small spaces. */
export function shortInr(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`;
  return `₹${Math.round(v)}`;
}

/** How many product cards fit in a row: 2 on phones, 3 on tablets, 4 on a laptop. `width` is the space available. */
export function gridColumns(width: number): number {
  return width >= 860 ? 4 : width >= 560 ? 3 : 2;
}
