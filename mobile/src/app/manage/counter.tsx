import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/Toast';
import { cardStyle, SectionHeader } from '@/components/manage/kit';
import { Banner, Button, Loading, QtyStepper } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { feedback } from '@/lib/feedback';
import { inr, mediaUrl, packName } from '@/lib/format';
import { useManage, useRefreshManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { ManageProduct, Order, Page } from '@/lib/types';

type Line = {
  unitId: string;
  productId: string;
  productName: string;
  unitName: string;
  pieces: number;
  listPrice: number;
  rate: string; // as typed
  qty: number;
  stockPieces: number;
};
type ShortLine = { item_id: string; product_name: string; unit_name: string; qty_wanted: number; qty_possible: number };

const money = (text: string) => Number(text.replace(/[₹,\s]/g, ''));

/** Sell at the counter to a walk-in customer: pick items, edit rates, choose Paid / Not paid, done. Stock goes down now. */
export default function CounterSaleScreen() {
  const { base, tenantId } = useManage();
  const router = useRouter();
  const refresh = useRefreshManage();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [paid, setPaid] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const found = useQuery({
    queryKey: ['mproducts', 'counter', base, q],
    queryFn: () => api<Page<ManageProduct>>(`${base}/products`, { query: { q, status: 'active', limit: 20 } }),
    enabled: !!tenantId,
  });

  if (!tenantId) return <Loading />;

  const total = lines.reduce((sum, l) => sum + (Number.isFinite(money(l.rate)) ? money(l.rate) : 0) * l.qty, 0);
  const badRate = lines.find((l) => !l.rate.trim() || !Number.isFinite(money(l.rate)) || money(l.rate) < 0);
  // Pieces asked per product (two packs of the same product share its stock)
  const asked = new Map<string, number>();
  lines.forEach((l) => asked.set(l.productId, (asked.get(l.productId) ?? 0) + l.qty * l.pieces));
  const overStock = lines.filter((l) => (asked.get(l.productId) ?? 0) > l.stockPieces);

  function addUnit(p: ManageProduct, unitId: string) {
    const u = p.units.find((x) => x.id === unitId)!;
    feedback.add();
    setLines((ls) => {
      const have = ls.find((l) => l.unitId === unitId);
      if (have) return ls.map((l) => (l.unitId === unitId ? { ...l, qty: l.qty + 1 } : l));
      return [
        ...ls,
        { unitId, productId: p.id, productName: p.name, unitName: u.name, pieces: u.pieces_per_unit, listPrice: u.price, rate: String(u.price), qty: 1, stockPieces: p.stock_pieces },
      ];
    });
    setSearch('');
  }

  const update = (unitId: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.unitId === unitId ? { ...l, ...patch } : l)));
  const remove = (unitId: string) => setLines((ls) => ls.filter((l) => l.unitId !== unitId));

  async function complete() {
    setError(null);
    if (!lines.length) return setError('Add at least one item');
    if (badRate) return setError(`Enter a rate for ${badRate.productName}`);
    if (paid === null) return setError('Choose Paid or Not paid');
    Alert.alert('Complete this sale?', `${lines.length} item${lines.length === 1 ? '' : 's'} · ${inr(total)} · ${paid ? 'Paid' : 'Not paid'}\nStock goes down now.`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Complete sale', onPress: () => void save() },
    ]);
  }

  async function save() {
    setSaving(true);
    try {
      const sale = await api<Order>(`${base}/counter-sales`, {
        method: 'POST',
        body: {
          items: lines.map((l) => ({ unit_id: l.unitId, qty: l.qty, rate: Math.round(money(l.rate) * 100) / 100 })),
          customer_name: customer.trim() || null,
          customer_phone: phone.trim() || null,
          paid,
          note: note.trim() || null,
        },
      });
      feedback.success();
      useToast.getState().show({ text: `Sale #${sale.order_no} done · ${inr(sale.items_total)}`, icon: 'checkmark-circle', tone: 'ok' });
      await refresh();
      router.replace({ pathname: '/manage/order/[id]', params: { id: sale.id } });
    } catch (err) {
      feedback.error();
      const detail = err instanceof ApiError ? (err.detail as { short?: ShortLine[] } | undefined) : undefined;
      if (detail?.short?.length) {
        // Not enough stock: bring those lines down to what's there.
        setLines((ls) =>
          ls
            .map((l) => {
              const s = detail.short!.find((x) => x.item_id === l.unitId);
              return s ? { ...l, qty: s.qty_possible } : l;
            })
            .filter((l) => l.qty > 0),
        );
        setError(`Not enough stock: ${detail.short.map((s) => `${s.product_name} (${s.unit_name}) only ${s.qty_possible}`).join(', ')}. Quantities were reduced; check and try again.`);
      } else setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const results = found.data?.items ?? [];

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search product to add"
              placeholderTextColor={colors.faint}
              style={styles.searchInput}
              autoCorrect={false}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.faint} />
              </Pressable>
            ) : null}
          </View>

          {(search.length > 0 || lines.length === 0) && (
            <View style={[cardStyle, styles.results]}>
              {found.isLoading ? (
                <ActivityIndicator style={{ margin: space.lg }} color={colors.primary} />
              ) : results.length === 0 ? (
                <Text style={styles.muted}>No product matches “{q}”.</Text>
              ) : (
                results.map((p, i) => (
                  <View key={p.id} style={[styles.result, i > 0 && styles.border]}>
                    <View style={styles.thumb}>
                      {p.thumbnails[0] ? (
                        <Image source={{ uri: mediaUrl(p.thumbnails[0]) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <Ionicons name="cube-outline" size={18} color={colors.faint} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={[styles.muted, p.stock_pieces <= 0 && { color: colors.error }]}>
                        {p.stock_pieces > 0 ? `${p.stock_pieces} pcs in stock` : 'Out of stock'}
                      </Text>
                      <View style={styles.units}>
                        {p.units.map((u) => (
                          <Pressable
                            key={u.id}
                            disabled={p.stock_pieces < u.pieces_per_unit}
                            onPress={() => addUnit(p, u.id)}
                            style={[styles.unitChip, p.stock_pieces < u.pieces_per_unit && { opacity: 0.4 }]}
                            accessibilityLabel={`Add ${p.name}, ${u.name}`}>
                            <Ionicons name="add" size={14} color={colors.primary} />
                            <Text style={styles.unitText}>
                              {packName(u.name, u.pieces_per_unit)} · {inr(u.price)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {lines.length > 0 && (
            <>
              <SectionHeader title={`Sale items (${lines.length})`} />
              <View style={{ gap: space.sm }}>
                {lines.map((l) => {
                  const rate = money(l.rate);
                  const over = overStock.includes(l);
                  return (
                    <View key={l.unitId} style={[cardStyle, styles.line, over && { borderColor: colors.error, borderWidth: 1 }]}>
                      <View style={styles.lineHead}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.name} numberOfLines={2}>
                            {l.productName}
                          </Text>
                          <Text style={styles.muted}>{packName(l.unitName, l.pieces)}</Text>
                        </View>
                        <Pressable onPress={() => remove(l.unitId)} hitSlop={10} accessibilityLabel={`Remove ${l.productName}`}>
                          <Ionicons name="trash-outline" size={18} color={colors.error} />
                        </Pressable>
                      </View>
                      <View style={styles.lineRow}>
                        <QtyStepper value={l.qty} min={1} step={1} max={null} onChange={(qty) => update(l.unitId, { qty })} />
                        <View style={styles.rateBox}>
                          <Text style={styles.rateLabel}>Rate ₹</Text>
                          <TextInput
                            value={l.rate}
                            onChangeText={(t) => update(l.unitId, { rate: t })}
                            keyboardType="decimal-pad"
                            style={[styles.rateInput, Number.isFinite(rate) && rate !== l.listPrice && { borderColor: colors.warn }]}
                            selectTextOnFocus
                          />
                        </View>
                        <Text style={styles.lineTotal}>{inr((Number.isFinite(rate) ? rate : 0) * l.qty)}</Text>
                      </View>
                      {Number.isFinite(rate) && rate !== l.listPrice && (
                        <Text style={[styles.muted, { color: colors.warn }]}>List price {inr(l.listPrice)}</Text>
                      )}
                      {over && <Text style={[styles.muted, { color: colors.error }]}>Only {l.stockPieces} pcs in stock</Text>}
                    </View>
                  );
                })}
              </View>

              <SectionHeader title="Customer (optional)" />
              <View style={[cardStyle, { padding: space.md, gap: space.sm }]}>
                <TextInput value={customer} onChangeText={setCustomer} placeholder="Name (blank = Walk-in customer)" placeholderTextColor={colors.faint} style={styles.input} maxLength={150} />
                <TextInput value={phone} onChangeText={setPhone} placeholder="Phone" placeholderTextColor={colors.faint} style={styles.input} keyboardType="phone-pad" maxLength={20} />
                <TextInput value={note} onChangeText={setNote} placeholder="Note" placeholderTextColor={colors.faint} style={styles.input} maxLength={500} />
              </View>

              <SectionHeader title="Payment" />
              <View style={styles.payRow}>
                {[
                  { v: true, label: 'Paid', icon: 'checkmark-circle' as const, tint: colors.ok, soft: colors.okSoft },
                  { v: false, label: 'Not paid', icon: 'time' as const, tint: colors.warn, soft: colors.warnSoft },
                ].map((o) => {
                  const on = paid === o.v;
                  return (
                    <Pressable
                      key={o.label}
                      onPress={() => setPaid(o.v)}
                      style={[styles.pay, on && { borderColor: o.tint, backgroundColor: o.soft }]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}>
                      <Ionicons name={o.icon} size={20} color={on ? o.tint : colors.faint} />
                      <Text style={[styles.payText, on && { color: o.tint }]}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          {error && (
            <View style={{ marginTop: space.md }}>
              <Banner kind="error" text={error} />
            </View>
          )}
        </ScrollView>

        {lines.length > 0 && (
          <View style={styles.footer}>
            <View style={{ flex: 1 }}>
              <Text style={styles.muted}>Total</Text>
              <Text style={styles.total}>{inr(total)}</Text>
            </View>
            <Button title="Complete sale" icon="checkmark-circle" onPress={complete} loading={saving} disabled={overStock.length > 0} style={{ flex: 1.4 }} />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.card },
  searchInput: { flex: 1, minHeight: 48, fontSize: 16, color: colors.text },
  results: { marginTop: space.md, paddingHorizontal: space.md, paddingVertical: space.xs },
  result: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.bg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.muted, marginTop: 2 },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  unitChip: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.primarySoft },
  unitText: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  line: { padding: space.md, gap: space.sm },
  lineHead: { flexDirection: 'row', gap: space.sm },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rateBox: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rateLabel: { fontSize: 12, color: colors.muted },
  rateInput: { width: 84, minHeight: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, fontSize: 15, color: colors.text, backgroundColor: colors.card },
  lineTotal: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '800', color: colors.text },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.md, fontSize: 15, color: colors.text, backgroundColor: colors.card },
  payRow: { flexDirection: 'row', gap: space.md },
  pay: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 54, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  payText: { fontSize: 16, fontWeight: '800', color: colors.muted },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  total: { fontSize: 22, fontWeight: '900', color: colors.text },
});
