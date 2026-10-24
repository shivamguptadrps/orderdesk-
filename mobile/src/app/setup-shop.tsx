import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { Banner, Button, Field, Loading } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useMe } from '@/lib/data';
import { colors, space } from '@/lib/theme';
import type { Me, Shop } from '@/lib/types';

/** First-time shop profile, or editing it later (from Profile). */
export default function SetupShopScreen() {
  const me = useMe();
  if (!me.data) return <Loading />;
  return <ShopForm me={me.data} key={me.data.shop?.id ?? 'new'} />;
}

function ShopForm({ me }: { me: Me }) {
  const router = useRouter();
  const qc = useQueryClient();
  const editing = !!me.shop;
  const [form, setForm] = useState({
    shop_name: me.shop?.shop_name ?? '',
    owner_name: me.shop?.owner_name ?? me.name ?? '',
    address: me.shop?.address ?? '',
    city: me.shop?.city ?? '',
    pincode: me.shop?.pincode ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const pincodeOk = /^[1-9]\d{5}$/.test(form.pincode);
  const complete = form.shop_name.trim() && form.owner_name.trim() && form.address.trim() && form.city.trim() && pincodeOk;

  async function save() {
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]));
    try {
      await api<Shop>(editing ? '/shops/me' : '/shops', { method: editing ? 'PUT' : 'POST', body });
      if (!me.name) await api('/me', { method: 'PUT', body: { name: body.owner_name } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      if (editing) router.back();
      else router.replace('/add-distributor');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
        {!editing && (
          <Text style={{ fontSize: 15, color: colors.muted, marginBottom: space.lg }}>
            Tell us about your shop. You do this once; every distributor you add will see these details.
          </Text>
        )}
        <Field label="Shop name" value={form.shop_name} onChangeText={set('shop_name')} placeholder="Sharma Kirana Store" />
        <Field label="Owner name" value={form.owner_name} onChangeText={set('owner_name')} placeholder="Raj Sharma" />
        <Field label="Address" value={form.address} onChangeText={set('address')} placeholder="Shop no., street, area" multiline />
        <Field label="City" value={form.city} onChangeText={set('city')} placeholder="Kanpur" />
        <Field
          label="Pincode"
          value={form.pincode}
          onChangeText={(t) => set('pincode')(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          placeholder="208001"
          error={form.pincode.length === 6 && !pincodeOk ? 'Enter a valid 6-digit pincode' : null}
        />
        {error && <Banner kind="error" text={error} />}
        <Button title={editing ? 'Save' : 'Continue'} onPress={save} loading={busy} disabled={!complete} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
