/**
 * Browser versions of phone-only pieces, so the same screens work on a laptop.
 * Imported once by the root layout; does nothing on phones.
 *
 * - Alert.alert does nothing in react-native-web: use the browser's alert / confirm (and a numbered
 *   prompt when there are several choices).
 * - Share.share: the browser share sheet if there is one, otherwise copy the text to the clipboard.
 */
import { Alert, type AlertButton, Platform, Share, type ShareContent } from 'react-native';

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    const all = buttons ?? [];
    const cancel = all.find((b) => b.style === 'cancel');
    const actions = all.filter((b) => b.style !== 'cancel');

    if (actions.length === 0) {
      window.alert(text);
      cancel?.onPress?.();
    } else if (actions.length === 1 && !cancel) {
      window.alert(text);
      actions[0].onPress?.();
    } else if (actions.length === 1) {
      if (window.confirm(text)) actions[0].onPress?.();
      else cancel?.onPress?.();
    } else {
      const menu = actions.map((b, i) => `${i + 1}. ${b.text}`).join('\n');
      const answer = window.prompt(`${text}\n\n${menu}\n\nType a number:`);
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= actions.length) actions[n - 1].onPress?.();
      else cancel?.onPress?.();
    }
  };

  Share.share = (async (content: ShareContent) => {
    const text = ('message' in content && content.message) || ('url' in content && content.url) || '';
    const nav = window.navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ text });
        return { action: Share.sharedAction };
      } catch (err) {
        if ((err as Error).name === 'AbortError') return { action: Share.dismissedAction };
      }
    }
    try {
      await nav.clipboard.writeText(text);
      window.alert('Copied. Paste it into WhatsApp or anywhere you like.');
    } catch {
      window.prompt('Copy this text:', text);
    }
    return { action: Share.sharedAction };
  }) as typeof Share.share;
}
