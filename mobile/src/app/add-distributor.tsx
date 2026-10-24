import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { Banner, Button, Field } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';
import type { MyDistributor } from '@/lib/types';

export default function AddDistributorScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [code, setCode] = useState((params.code ?? '').toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MyDistributor | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const d = await api<MyDistributor>('/shops/me/distributors', { method: 'POST', body: { join_code: code.trim() } });
      setResult(d);
      await qc.invalidateQueries({ queryKey: ['myDistributors'] });
      if (d.status === 'active') useSession.getState().chooseShopMode(d.tenant_id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.xl }}>
        {result.status === 'active' ? (
          <Banner kind="ok" text={`You can now order from ${result.name}.`} />
        ) : result.status === 'pending' ? (
          <Banner kind="warn" text={`Request sent to ${result.name}. You can order as soon as they approve your shop.`} />
        ) : (
          <Banner kind="error" text={`${result.name} has blocked orders from this shop. Please contact them.`} />
        )}
        <Button title="Done" onPress={() => router.replace('/home')} />
        <Button title="Add another" variant="ghost" onPress={() => {
            setResult(null);
            setCode('');
          }} style={{ marginTop: space.md }} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 15, color: colors.muted, marginBottom: space.lg }}>
          Enter the join code your distributor gave you (on their card, bill or WhatsApp), or scan their QR code.
        </Text>
        <Field
          label="Join code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
          placeholder="e.g. DEMO01"
          autoCapitalize="characters"
          autoCorrect={false}
          style={{ fontSize: 22, letterSpacing: 3, fontWeight: '700' }}
        />
        {error && <Banner kind="error" text={error} />}
        <Button title="Add distributor" onPress={join} loading={busy} disabled={code.trim().length < 4} />
        <Button title="Scan QR code" icon="qr-code-outline" variant="secondary" onPress={() => router.push('/scan')} style={{ marginTop: space.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
