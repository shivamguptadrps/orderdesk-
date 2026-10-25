import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';

import { buildUrl } from './api';
import { useAuth } from './auth';

/** Browser: fetch with the login token and save the file (bill PDF, QR) like a normal download. */
async function downloadInBrowser(path: string, fileName: string) {
  const token = useAuth.getState().accessToken;
  const res = await fetch(buildUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Download a file from the API (with the login token) and open the share sheet (WhatsApp, Files, Print...). */
export async function downloadAndShare(path: string, fileName: string, mimeType: string, title: string) {
  const safeName = fileName.replace(/[^\w.-]+/g, '-');
  if (Platform.OS === 'web') return downloadInBrowser(path, safeName);
  const file = new File(Paths.cache, safeName);
  if (file.exists) file.delete();
  const task = File.createDownloadTask(buildUrl(path), file, {
    headers: { Authorization: `Bearer ${useAuth.getState().accessToken}` },
  });
  const saved = await task.downloadAsync();
  if (!saved) return;
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(saved.uri, {
      mimeType,
      dialogTitle: title,
      UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.png',
    });
  } else {
    Alert.alert('Saved', saved.uri);
  }
}
