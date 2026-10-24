import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

import { buildUrl } from './api';
import { useAuth } from './auth';

/** Download a file from the API (with the login token) and open the share sheet (WhatsApp, Files, Print...). */
export async function downloadAndShare(path: string, fileName: string, mimeType: string, title: string) {
  const file = new File(Paths.cache, fileName.replace(/[^\w.-]+/g, '-'));
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
