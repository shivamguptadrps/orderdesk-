import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { type PushData, registerForPush } from '@/lib/push';
import { useSession } from '@/lib/session';

/** Lists that a notification makes out of date. */
type Router = ReturnType<typeof useRouter>;

const FRESHEN = ['orders', 'order', 'morders', 'dashboard', 'mshops', 'myDistributors', 'me', 'agentShops', 'report'];

/** Open the screen a notification is about, switching to the right distributor and mode first. */
function open(data: PushData, router: Router) {
  const session = useSession.getState();
  const tenant = data.tenant_id;
  if (!tenant) return;
  if (data.for === 'manage') {
    session.chooseManageMode(tenant);
    if (data.type === 'order' && data.order_id) router.push(`/manage/order/${data.order_id}`);
    else if (data.type === 'shop') router.push('/manage/shops');
    else router.replace('/dashboard');
    return;
  }
  if (data.for === 'agent') session.chooseAgentMode(tenant);
  else session.chooseShopMode(tenant);
  if (data.type === 'order' && data.order_id) {
    router.push({ pathname: '/order/[id]', params: { id: data.order_id, tenant } });
  } else {
    router.replace('/home');
  }
}

/** Registers this phone for notifications after login, refreshes data when one arrives, and opens it when tapped. */
export function PushHandler() {
  if (Platform.OS === 'web') return null; // no push in web previews
  return <PushListeners />;
}

function PushListeners() {
  const status = useAuth((s) => s.status);
  const sessionLoaded = useSession((s) => s.loaded);
  const router = useRouter();
  const qc = useQueryClient();
  const handledColdStart = useRef(false);

  useEffect(() => {
    if (status === 'signedIn') void registerForPush();
  }, [status]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => {
      FRESHEN.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }));
    });
    return () => received.remove();
  }, [qc]);

  useEffect(() => {
    if (status !== 'signedIn' || !sessionLoaded) return;
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      FRESHEN.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }));
      open(response.notification.request.content.data as PushData, router);
    });
    // App opened by tapping a notification while it was closed.
    if (!handledColdStart.current) {
      handledColdStart.current = true;
      const last = Notifications.getLastNotificationResponse();
      if (last) {
        Notifications.clearLastNotificationResponse();
        setTimeout(() => open(last.notification.request.content.data as PushData, router), 300);
      }
    }
    return () => tapped.remove();
  }, [status, sessionLoaded, router, qc]);

  return null;
}
