import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card } from '@/components/ui';
import { API_URL, api, errorText } from '@/lib/api';
import { colors, space } from '@/lib/theme';

type Health = { status: string; db: string; env: string };

/** Shows whether the phone can reach the backend. Linked from Profile and from connection errors. */
export default function HealthScreen() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health', { auth: false, timeoutMs: 8000 }),
    retry: false,
  });

  return (
    <View style={styles.screen}>
      <Text style={styles.sub}>Server: {API_URL}</Text>
      <Card style={styles.card}>
        {health.isFetching ? (
          <Text style={styles.detail}>Checking…</Text>
        ) : health.isSuccess ? (
          <>
            <Text style={[styles.status, { color: colors.ok }]}>API OK</Text>
            <Text style={styles.detail}>
              Database: {health.data.db} · Env: {health.data.env}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.status, { color: colors.error }]}>API not reachable</Text>
            <Text style={styles.detail}>{errorText(health.error)}</Text>
            <Text style={styles.hint}>
              Check the backend is running with --host 0.0.0.0, the phone is on the same Wi-Fi, and the address in
              mobile/.env.local is the laptop&apos;s current Wi-Fi IP.
            </Text>
          </>
        )}
      </Card>
      <Button title="Check again" onPress={() => health.refetch()} style={{ marginTop: space.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space.xl },
  sub: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  card: { marginTop: space.lg, minHeight: 140, alignItems: 'center', justifyContent: 'center', gap: 8 },
  status: { fontSize: 24, fontWeight: '700' },
  detail: { fontSize: 14, color: colors.text, textAlign: 'center' },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 8 },
});
