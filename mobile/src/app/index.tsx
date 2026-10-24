import { Redirect, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Button, ErrorView, Loading } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useWorkspace } from '@/lib/data';
import { useSession } from '@/lib/session';

/** Decides where to start: login, shop setup, or the app. */
export default function Gate() {
  const status = useAuth((s) => s.status);
  const sessionLoaded = useSession((s) => s.loaded);
  const ws = useWorkspace();
  const router = useRouter();

  if (status === 'loading' || !sessionLoaded) return <Loading />;
  if (status === 'signedOut') return <Redirect href="/login" />;
  if (ws.me.isError) {
    return (
      <View style={{ flex: 1 }}>
        <ErrorView message={errorText(ws.me.error)} onRetry={() => ws.me.refetch()} />
        <Button title="Check server connection" variant="ghost" onPress={() => router.push('/health')} />
      </View>
    );
  }
  if (ws.loading || !ws.me.data) return <Loading />;

  const me = ws.me.data;
  if (!me.shop && !me.memberships.length) return <Redirect href="/setup-shop" />;
  if (ws.current?.mode === 'manage') return <Redirect href="/dashboard" />;
  return <Redirect href="/home" />;
}
