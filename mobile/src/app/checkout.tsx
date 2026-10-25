import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Empty, ErrorView, Loading } from '@/components/ui';
import { ApiError, api, errorText } from '@/lib/api';
import { cartKey, useCart, useRefreshOrders, useWorkspace, type Workspace } from '@/lib/data';
import { feedback } from '@/lib/feedback';
import { cartSavings, inr, mediaUrl, packName } from '@/lib/format';
import { shopParam } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';
import type { Order, Shop } from '@/lib/types';

/** Review before placing: where it goes, what's in it, the total. Nothing is ordered until "Confirm order". */
export default function CheckoutScreen() {
  const ws = useWorkspace();
  if (ws.loading) return <Loading />;
  if (!ws.current) return <ErrorView message="Choose a distributor first." />;
  return <Review ws={ws.current} shop={ws.me.data?.shop ?? null} />;
}

function Review({ ws, shop }: { ws: Workspace; shop: Shop | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const refreshOrders = useRefreshOrders();
  const cart = useCart(ws);
  const base = `/t/${ws.tenantId}`;

  const place = useMutation({
    mutationFn: () =>
      api<Order>(`${base}/orders`, { method: 'POST', body: { expected_total: cart.data!.total }, query: shopParam(ws.mode, ws.agentShop) }),
    onSuccess: async (order) => {
      const saved = cartSavings(cart.data?.items ?? []);
      await refreshOrders();
      router.dismissAll();
      router.push({
        pathname: '/order-placed',
        params: { id: order.id, tenant: order.tenant_id, no: String(order.order_no), total: String(order.items_total), saved: String(saved), from: ws.name },
      });
    },
    onError: async (err) => {
      feedback.error();
      await qc.invalidateQueries({ queryKey: cartKey(ws) });
      const changed = err instanceof ApiError && err.status === 409;
      Alert.alert(changed ? 'Please check again' : "Couldn't place order", errorText(err));
    },
  });

  if (cart.isLoading) return <Loading />;
  if (cart.isError) return <ErrorView message={errorText(cart.error)} onRetry={() => cart.refetch()} />;
  const c = cart.data!;
  if (!c.items.length) return <Empty icon="cart-outline" title="Your cart is empty" action={<Button title="Back to shop" onPress={() => router.dismissAll()} />} />;

  const agent = ws.mode === 'agent';
  const hasPin = !agent && shop?.lat != null && shop?.lng != null;
  const problems = c.items.filter((i) => i.problem).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xl }}>
        <View style={styles.steps}>
          <Step n={1} label="Cart" done />
          <View style={styles.stepLine} />
          <Step n={2} label="Review" active />
          <View style={styles.stepLine} />
          <Step n={3} label="Placed" />
        </View>

        <View style={styles.card}>
          <Row icon="business" label="Ordering from" value={ws.name} />
          <View style={styles.divider} />
          {agent ? (
            <Row icon="storefront" label="Order for shop" value={ws.agentShop?.name ?? ''} sub="Placed by you as agent" />
          ) : shop ? (
            <>
              <Row
                icon="location"
                label="Deliver to"
                value={shop.shop_name}
                sub={`${shop.address}, ${shop.city} - ${shop.pincode}`}
                action={{ text: 'Change', onPress: () => router.push('/setup-shop') }}
              />
              <View style={[styles.pin, { backgroundColor: hasPin ? colors.okSoft : colors.warnSoft }]}>
                <Ionicons name={hasPin ? 'checkmark-circle' : 'alert-circle'} size={16} color={hasPin ? colors.ok : colors.warn} />
                <Text style={[styles.pinText, { color: hasPin ? colors.ok : colors.warn }]}>
                  {hasPin ? 'Shop location saved on map' : 'No map location yet. Add it so delivery can find you.'}
                </Text>
                {!hasPin && (
                  <Pressable onPress={() => router.push('/setup-shop')} hitSlop={8}>
                    <Text style={styles.pinLink}>Add</Text>
                  </Pressable>
                )}
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Items ({c.item_count})</Text>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={styles.link}>Edit</Text>
            </Pressable>
          </View>
          {c.items.map((i, n) => (
            <View key={i.id} style={[styles.item, n > 0 && styles.itemBorder]}>
              <View style={styles.thumb}>
                {i.image ? <Image source={{ uri: mediaUrl(i.image) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="cube-outline" size={18} color={colors.faint} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {i.product_name}
                </Text>
                <Text style={styles.itemMeta}>
                  <Text style={styles.itemQty}>
                    {i.qty} × {packName(i.unit_name, i.pieces_per_unit)}
                  </Text>
                  {'  '}@ {inr(i.price)}
                  {i.pieces_per_unit > 1 ? `  ·  ${i.qty * i.pieces_per_unit} pcs` : ''}
                </Text>
                {i.problem && <Text style={styles.problem}>{i.problem}</Text>}
              </View>
              <Text style={styles.itemTotal}>{inr(i.line_total)}</Text>
            </View>
          ))}
        </View>

        {c.note ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Note for the distributor</Text>
            <Text style={styles.note}>{c.note}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bill summary</Text>
          <View style={styles.billRow}>
            <Text style={styles.billLabel}>Items total</Text>
            <Text style={styles.billValue}>{inr(c.total)}</Text>
          </View>
          <View style={styles.billRow}>
            <Text style={styles.billLabel}>Payment</Text>
            <Text style={[styles.billValue, { color: colors.muted, fontWeight: '400' }]}>Offline, to the distributor</Text>
          </View>
          {cartSavings(c.items) > 0 && (
            <View style={styles.billRow}>
              <Text style={[styles.billLabel, { color: '#1A7F37' }]}>You save on MRP</Text>
              <Text style={[styles.billValue, { color: '#1A7F37', fontWeight: '800' }]}>− {inr(cartSavings(c.items))}</Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.billRow}>
            <Text style={styles.grandLabel}>Order total</Text>
            <Text style={styles.grand}>{inr(c.total)}</Text>
          </View>
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={16} color={colors.primaryDark} />
            <Text style={styles.noticeText}>
              {ws.name} checks stock and confirms your order. They may change quantities; you&apos;ll see the final bill before delivery.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Text style={styles.footerLabel}>Order total</Text>
          <Text style={styles.footerTotal}>{inr(c.total)}</Text>
        </View>
        <Button
          title="Confirm order"
          icon="checkmark-circle"
          onPress={() => place.mutate()}
          loading={place.isPending}
          disabled={!c.can_place_order || problems > 0}
          style={{ minWidth: 190 }}
        />
      </View>
    </SafeAreaView>
  );
}

function Step({ n, label, done, active }: { n: number; label: string; done?: boolean; active?: boolean }) {
  const on = done || active;
  return (
    <View style={styles.step}>
      <View style={[styles.stepDot, on && { backgroundColor: done ? colors.ok : colors.primary, borderColor: 'transparent' }]}>
        {done ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : <Text style={[styles.stepN, on && { color: '#FFFFFF' }]}>{n}</Text>}
      </View>
      <Text style={[styles.stepLabel, on && { color: colors.text, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  sub,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  sub?: string;
  action?: { text: string; onPress: () => void };
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={styles.link}>{action.text}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: space.sm },
  step: { alignItems: 'center', gap: 4 },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  stepN: { fontSize: 12, fontWeight: '800', color: colors.muted },
  stepLabel: { fontSize: 11, color: colors.muted },
  stepLine: { width: 48, height: 2, backgroundColor: colors.border, marginHorizontal: 6, marginBottom: 16 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: '#EEF0F3' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: space.sm },
  link: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.md },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  rowValue: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 1 },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.sm, padding: space.sm, marginTop: space.md },
  pinText: { flex: 1, fontSize: 12, fontWeight: '600' },
  pinLink: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#F3F5F7', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 14, fontWeight: '600', color: colors.text },
  itemMeta: { fontSize: 12, color: colors.muted, marginTop: 3 },
  itemQty: { color: colors.text, fontWeight: '800' },
  problem: { fontSize: 12, color: colors.error, fontWeight: '600', marginTop: 2 },
  itemTotal: { fontSize: 15, fontWeight: '800', color: colors.text },
  note: { fontSize: 14, color: colors.text, lineHeight: 20 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 },
  billLabel: { fontSize: 14, color: colors.text },
  billValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  grandLabel: { fontSize: 16, fontWeight: '800', color: colors.text },
  grand: { fontSize: 20, fontWeight: '900', color: colors.text },
  notice: { flexDirection: 'row', gap: 6, backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: space.sm, marginTop: space.md },
  noticeText: { flex: 1, fontSize: 12, color: colors.primaryDark, lineHeight: 17 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footerLabel: { fontSize: 12, color: colors.muted },
  footerTotal: { fontSize: 22, fontWeight: '900', color: colors.text },
});
