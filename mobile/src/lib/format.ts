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
