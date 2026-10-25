import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { type FoundAddress, LocationField, type Pin } from '@/components/LocationField';
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
  const [pin, setPin] = useState<Pin | null>(
    me.shop?.lat != null && me.shop?.lng != null ? { lat: Number(me.shop.lat), lng: Number(me.shop.lng) } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const fillEmpty = (found: FoundAddress) =>
    setForm((f) => ({
      ...f,
      address: f.address.trim() ? f.address : (found.address ?? f.address),
      city: f.city.trim() ? f.city : (found.city ?? f.city),
      pincode: f.pincode.trim() ? f.pincode : (found.pincode?.replace(/\D/g, '').slice(0, 6) ?? f.pincode),
    }));

  const pincodeOk = /^[1-9]\d{5}$/.test(form.pincode);
  const complete = form.shop_name.trim() && form.owner_name.trim() && form.address.trim() && form.city.trim() && pincodeOk;

  async function save() {
    setBusy(true);
    setError(null);
    const body = { ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])), ...(pin ?? {}) };
    try {
      await api<Shop>(editing ? '/shops/me' : '/shops', { method: editing ? 'PUT' : 'POST', body });
      if (!me.name) await api('/me', { method: 'PUT', body: { name: form.owner_name.trim() } });
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
        <LocationField value={pin} onChange={setPin} onAddress={fillEmpty} />
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
