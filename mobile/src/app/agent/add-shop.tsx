import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { Banner, Button, Field, Loading } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useWorkspace } from '@/lib/data';
import { colors, space } from '@/lib/theme';
import type { AgentShop } from '@/lib/types';

/** Agent signs up a shop during a visit. */
export default function AddShopScreen() {
  const ws = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState({ owner_phone: '', shop_name: '', owner_name: '', address: '', city: '', pincode: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AgentShop | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  if (ws.loading) return <Loading />;
  const tenantId = ws.current?.mode === 'agent' ? ws.current.tenantId : ws.agentOptions[0]?.tenantId;

  const phoneOk = /^[6-9]\d{9}$/.test(form.owner_phone);
  const pincodeOk = /^[1-9]\d{5}$/.test(form.pincode);
  const complete = phoneOk && pincodeOk && form.shop_name.trim() && form.owner_name.trim() && form.address.trim() && form.city.trim();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]));
      const shop = await api<AgentShop>(`/t/${tenantId}/agent/shops`, { method: 'POST', body });
      await qc.invalidateQueries({ queryKey: ['agentShops'] });
      setDone(shop);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.xl }}>
        <Banner
          kind={done.status === 'active' ? 'ok' : 'warn'}
          text={
            done.status === 'active'
              ? `${done.shop_name} is added. You can order for it now.`
              : `${done.shop_name} is added and waiting for the distributor's approval.`
          }
        />
        <Text style={{ color: colors.muted, marginBottom: space.lg }}>
          The shop owner can also log in with {done.owner_phone} to order by themselves.
        </Text>
        <Button title="Back to my shops" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
        <Field
          label="Shop owner's mobile"
          value={form.owner_phone}
          onChangeText={(t) => set('owner_phone')(t.replace(/\D/g, '').slice(0, 10))}
          keyboardType="number-pad"
          placeholder="10-digit number"
          hint="They can log in with this number later."
        />
        <Field label="Shop name" value={form.shop_name} onChangeText={set('shop_name')} />
        <Field label="Owner name" value={form.owner_name} onChangeText={set('owner_name')} />
        <Field label="Address" value={form.address} onChangeText={set('address')} multiline />
        <Field label="City" value={form.city} onChangeText={set('city')} />
        <Field
          label="Pincode"
          value={form.pincode}
          onChangeText={(t) => set('pincode')(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
        />
        {error && <Banner kind="error" text={error} />}
        <Button title="Add shop" onPress={save} loading={busy} disabled={!complete || !tenantId} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
