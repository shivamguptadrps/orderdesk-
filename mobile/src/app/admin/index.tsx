import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Avatar, cardStyle, IconBubble } from '@/components/manage/kit';
import { Banner, Button, Empty, ErrorView, Field, Loading, SkeletonList } from '@/components/ui';
import { ApiError, api, errorText } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { storage } from '@/lib/storage';
import { colors, radius, space } from '@/lib/theme';
import type { AdminTenant } from '@/lib/types';

const KEY_STORE = 'admin.key';

/** Platform admin (OrderDesk operator): add distributors and turn them on/off. Needs the admin key once. */
export default function AdminScreen() {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void storage.get(KEY_STORE).then((k) => setKey(k));
  }, []);

  if (key === undefined) return <Loading />;
  if (!key) return <KeyGate onSaved={setKey} />;
  return (
    <Console
      adminKey={key}
      onKeyRejected={async () => {
        await storage.remove(KEY_STORE);
        setKey(null);
      }}
    />
  );
}

function KeyGate({ onSaved }: { onSaved: (k: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/tenants', { headers: { 'X-Admin-Key': value.trim() } });
      await storage.set(KEY_STORE, value.trim());
      onSaved(value.trim());
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'That key is not right.' : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: space.xl }}>
          <IconBubble icon="shield-checkmark" tone="purple" size={72} />
          <Text style={styles.gateTitle}>Platform admin</Text>
          <Text style={styles.gateText}>Enter the admin key from the server settings. It&apos;s saved securely on this phone, so you only do this once.</Text>
        </View>
        <Field label="Admin key" value={value} onChangeText={setValue} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Paste the key" />
        {error && <Banner kind="error" text={error} />}
        <Button title="Unlock" icon="lock-open-outline" onPress={check} loading={busy} disabled={value.trim().length < 24} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Console({ adminKey, onKeyRejected }: { adminKey: string; onKeyRejected: () => void }) {
  const qc = useQueryClient();
  const headers = { 'X-Admin-Key': adminKey };
  const tenants = useQuery({ queryKey: ['admin-tenants'], queryFn: () => api<AdminTenant[]>('/admin/tenants', { headers }) });
  const [form, setForm] = useState({ name: '', owner_phone: '', owner_name: '', join_code: '' });
  const [created, setCreated] = useState<AdminTenant | null>(null);
  const [open, setOpen] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (tenants.error instanceof ApiError && tenants.error.status === 403) onKeyRejected();
  }, [tenants.error, onKeyRejected]);

  const create = useMutation({
    mutationFn: () =>
      api<AdminTenant>('/admin/tenants', {
        method: 'POST',
        headers,
        body: {
          name: form.name.trim(),
          owner_phone: form.owner_phone,
          owner_name: form.owner_name.trim() || null,
          join_code: form.join_code.trim() || null,
        },
      }),
    onSuccess: async (t) => {
      setCreated(t);
      setOpen(false);
      setForm({ name: '', owner_phone: '', owner_name: '', join_code: '' });
      await qc.invalidateQueries({ queryKey: ['admin-tenants'] });
    },
  });

  const toggle = useMutation({
    mutationFn: (t: AdminTenant) => api<AdminTenant>(`/admin/tenants/${t.id}/${t.status === 'active' ? 'suspend' : 'activate'}`, { method: 'POST', headers }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-tenants'] }),
    onError: (err) => Alert.alert("Couldn't change", errorText(err)),
  });

  function welcome(t: AdminTenant) {
    return [
      `Welcome to OrderDesk, ${t.owner_name ?? t.name}!`,
      `1. Install the OrderDesk app.`,
      `2. Log in with ${t.owner_phone?.replace('+91', '') ?? 'your number'} (code comes on the screen/WhatsApp).`,
      `3. You'll see ${t.name}: add your logo (More › Business profile), products and agents.`,
      `4. Shops join you with code ${t.join_code}.`,
    ].join('\n');
  }

  const phoneOk = /^[6-9]\d{9}$/.test(form.owner_phone);
  const list = tenants.data ?? [];
  const active = list.filter((t) => t.status === 'active').length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.md }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={tenants.isRefetching} onRefresh={() => void tenants.refetch()} />}>
        <View style={styles.stats}>
          <Stat label="Distributors" value={list.length} />
          <Stat label="Active" value={active} />
          <Stat label="Shops" value={list.reduce((s, t) => s + t.shops, 0)} />
          <Stat label="Orders" value={list.reduce((s, t) => s + t.orders, 0)} />
        </View>

        {created && (
          <View style={[cardStyle, styles.created]}>
            <View style={styles.row}>
              <Ionicons name="checkmark-circle" size={22} color={colors.ok} />
              <Text style={styles.createdTitle}>{created.name} is ready</Text>
            </View>
            <Text style={styles.createdText}>
              Owner logs in with {created.owner_phone}. Join code for shops: <Text style={styles.code}>{created.join_code}</Text>
            </Text>
            <Button title="Send welcome message" icon="logo-whatsapp" onPress={() => Share.share({ message: welcome(created) })} />
          </View>
        )}

        {!open ? (
          <Button title="Add distributor" icon="add-circle-outline" onPress={() => { setOpen(true); setCreated(null); }} />
        ) : (
          <View style={[cardStyle, { padding: space.lg }]}>
            <Text style={styles.formTitle}>New distributor</Text>
            <Field label="Business name" value={form.name} onChangeText={set('name')} placeholder="Gupta Traders" />
            <Field
              label="Owner's mobile"
              value={form.owner_phone}
              onChangeText={(t) => set('owner_phone')(t.replace(/\D/g, '').slice(0, 10))}
              keyboardType="number-pad"
              placeholder="10-digit number"
              hint="They log in with this number and become the owner."
            />
            <Field label="Owner's name (optional)" value={form.owner_name} onChangeText={set('owner_name')} placeholder="Ramesh Gupta" />
            <Field
              label="Join code (optional)"
              value={form.join_code}
              onChangeText={(t) => set('join_code')(t.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12))}
              autoCapitalize="characters"
              placeholder="e.g. GUPTA7 · leave empty for a random one"
            />
            <Text style={styles.hint}>Starter FMCG categories (Staples, Snacks, Beverages…) are added automatically.</Text>
            {create.isError && <Banner kind="error" text={errorText(create.error)} />}
            <View style={styles.row}>
              <Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} style={{ flex: 1 }} />
              <Button title="Create" icon="checkmark" onPress={() => create.mutate()} loading={create.isPending} disabled={form.name.trim().length < 2 || !phoneOk} style={{ flex: 1 }} />
            </View>
          </View>
        )}

        <Text style={styles.section}>All distributors</Text>
        {tenants.isLoading ? (
          <SkeletonList count={3} />
        ) : tenants.isError ? (
          <ErrorView message={errorText(tenants.error)} onRetry={() => tenants.refetch()} />
        ) : !list.length ? (
          <Empty icon="business-outline" title="No distributors yet" text="Add the first one above." />
        ) : (
          list.map((t) => (
            <View key={t.id} style={[cardStyle, styles.tenant, t.status !== 'active' && { opacity: 0.65 }]}>
              <View style={styles.row}>
                <Avatar name={t.name} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tenantName}>{t.name}</Text>
                  <Text style={styles.meta}>
                    {t.owner_name ? `${t.owner_name} · ` : ''}
                    {t.owner_phone ?? 'no owner'}
                  </Text>
                </View>
                <View style={[styles.status, { backgroundColor: t.status === 'active' ? colors.okSoft : colors.errorSoft }]}>
                  <Text style={[styles.statusText, { color: t.status === 'active' ? colors.ok : colors.error }]}>{t.status === 'active' ? 'Active' : 'Suspended'}</Text>
                </View>
              </View>
              <View style={styles.facts}>
                <Fact icon="key-outline" text={t.join_code} />
                <Fact icon="storefront-outline" text={`${t.shops} shops`} />
                <Fact icon="cube-outline" text={`${t.products} products`} />
                <Fact icon="receipt-outline" text={`${t.orders} orders`} />
              </View>
              <View style={styles.tenantFoot}>
                <Text style={styles.meta}>Since {shortDate(t.created_at)}</Text>
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <Pressable onPress={() => Share.share({ message: welcome(t) })} hitSlop={8}>
                    <Text style={styles.link}>Welcome msg</Text>
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      Alert.alert(
                        t.status === 'active' ? `Suspend ${t.name}?` : `Reactivate ${t.name}?`,
                        t.status === 'active'
                          ? 'Their team and shops cannot use it until you reactivate. Nothing is deleted.'
                          : 'They can use the app again straight away.',
                        [
                          { text: 'Back', style: 'cancel' },
                          { text: t.status === 'active' ? 'Suspend' : 'Reactivate', style: t.status === 'active' ? 'destructive' : 'default', onPress: () => toggle.mutate(t) },
                        ],
                      )
                    }>
                    <Text style={[styles.link, t.status === 'active' && { color: colors.error }]}>{t.status === 'active' ? 'Suspend' : 'Reactivate'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}

        <Pressable
          onPress={() =>
            Alert.alert('Forget the admin key on this phone?', 'You will need to enter it again.', [
              { text: 'Keep', style: 'cancel' },
              { text: 'Forget', style: 'destructive', onPress: onKeyRejected },
            ])
          }
          style={{ alignSelf: 'center', marginTop: space.lg }}>
          <Text style={[styles.link, { color: colors.muted }]}>Forget admin key on this phone</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={[cardStyle, styles.stat]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Fact({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={13} color={colors.muted} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gateTitle: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: space.md },
  gateText: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: space.sm, lineHeight: 20 },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, padding: space.md, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '900', color: colors.text },
  statLabel: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  created: { padding: space.lg, gap: space.md, borderColor: colors.ok },
  createdTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  createdText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  code: { fontWeight: '900', letterSpacing: 1 },
  formTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: space.md },
  hint: { fontSize: 12, color: colors.muted, marginBottom: space.md },
  section: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: space.md },
  tenant: { padding: space.lg },
  tenantName: { fontSize: 16, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '800' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  factText: { fontSize: 12, color: colors.text, fontWeight: '600' },
  tenantFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  link: { color: colors.primary, fontWeight: '800', fontSize: 13 },
});
