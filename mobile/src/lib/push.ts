import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { api, errorText } from './api';
import { storage } from './storage';

/** Saved so logout can tell the server to stop notifying this phone (read by auth.ts). */
export const PUSH_TOKEN_KEY = 'push.token';

export type PushStatus =
  | 'unknown'
  | 'on'
  | 'denied' // the user said no (can be changed in phone settings)
  | 'unsupported' // simulator, or Expo Go on Android
  | 'not-configured' // app has no Expo project id yet (eas init)
  | 'error';

export const usePush = create<{ status: PushStatus; detail: string | null }>()(() => ({
  status: Platform.OS === 'web' ? 'unsupported' : 'unknown',
  detail: null,
}));

// Show notifications even while the app is open.
if (Platform.OS !== 'web') Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Ask permission (first time only), get this phone's Expo push token and send it to the server. */
export async function registerForPush(): Promise<PushStatus> {
  const set = (status: PushStatus, detail: string | null = null) => {
    usePush.setState({ status, detail });
    return status;
  };
  try {
    const expoGoAndroid = Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    if (!Device.isDevice || expoGoAndroid || Platform.OS === 'web') return set('unsupported');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Orders',
        importance: AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return set('denied');

    const id = projectId();
    if (!id) return set('not-configured');
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    await api('/me/push-tokens', { method: 'POST', body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
    await storage.set(PUSH_TOKEN_KEY, token);
    return set('on');
  } catch (err) {
    return set('error', errorText(err));
  }
}

export type PushData = {
  type?: 'order' | 'shop' | 'distributor';
  for?: 'manage' | 'shop' | 'agent';
  tenant_id?: string;
  order_id?: string;
  shop_id?: string;
};
