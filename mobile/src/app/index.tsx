import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { API_URL, ApiError, apiGet, type Health } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: Health }
  | { kind: 'error'; message: string };

export default function HealthScreen() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(() => {
    apiGet<Health>('/health')
      .then((health) => setState({ kind: 'ok', health }))
      .catch((err) =>
        setState({ kind: 'error', message: err instanceof ApiError ? err.message : String(err) }),
      );
  }, []);

  useEffect(load, [load]);

  const check = () => {
    setState({ kind: 'loading' });
    load();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.brand}>OrderDesk</Text>
      <Text style={styles.sub}>Server: {API_URL}</Text>

      <View style={styles.card}>
        {state.kind === 'loading' && <ActivityIndicator size="large" color={colors.primary} />}

        {state.kind === 'ok' && (
          <>
            <Text style={[styles.status, { color: colors.ok }]}>API OK</Text>
            <Text style={styles.detail}>
              Database: {state.health.db} · Env: {state.health.env}
            </Text>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <Text style={[styles.status, { color: colors.error }]}>API not reachable</Text>
            <Text style={styles.detail}>{state.message}</Text>
            <Text style={styles.hint}>
              Check the backend is running with --host 0.0.0.0, the phone is on the same Wi-Fi, and the
              Windows firewall allows port 8000.
            </Text>
          </>
        )}
      </View>

      <Pressable
        onPress={check}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
        accessibilityRole="button">
        <Text style={styles.buttonText}>Check again</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const colors = {
  primary: '#1F6FEB',
  ok: '#1A7F37',
  error: '#CF222E',
  text: '#1F2328',
  muted: '#656D76',
  card: '#F6F8FA',
};

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, backgroundColor: '#FFFFFF', justifyContent: 'center' },
  brand: { fontSize: 32, fontWeight: '700', color: colors.text, textAlign: 'center' },
  sub: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6 },
  card: {
    marginTop: 32,
    padding: 24,
    minHeight: 140,
    borderRadius: 16,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  status: { fontSize: 24, fontWeight: '700' },
  detail: { fontSize: 14, color: colors.text, textAlign: 'center' },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 8 },
  button: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
