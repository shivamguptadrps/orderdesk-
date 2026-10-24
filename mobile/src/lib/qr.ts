/** A QR can hold the bare code ("DEMO01") or a link containing it (".../join/DEMO01" or "?code=DEMO01"). */
export function codeFromQr(data: string): string | null {
  const text = data.trim();
  if (/^[A-Za-z0-9]{4,12}$/.test(text)) return text.toUpperCase();
  const fromQuery = text.match(/[?&]code=([A-Za-z0-9]{4,12})/);
  if (fromQuery) return fromQuery[1].toUpperCase();
  const fromPath = text.match(/\/join\/([A-Za-z0-9]{4,12})\/?$/);
  return fromPath ? fromPath[1].toUpperCase() : null;
}
