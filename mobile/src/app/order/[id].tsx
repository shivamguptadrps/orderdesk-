import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OrderProgress } from '@/components/shop/OrderProgress';
import { Banner, Button, Card, ErrorView, Loading, SectionTitle, SkeletonList, StatusBadge } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useRefreshOrders, useWorkspace } from '@/lib/data';
import { downloadAndShare } from '@/lib/files';
import { dateTime, inr, packLabel, STATUS_LABEL } from '@/lib/format';
import { useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';
import type { Order, OrderItem } from '@/lib/types';

export default function OrderScreen() {
  const { id, tenant, placed } = useLocalSearchParams<{ id: string; tenant: string; placed?: string }>();
  const ws = useWorkspace();
  if (ws.loading) return <Loading />;
  return <OrderView id={id} tenant={tenant} justPlaced={placed === '1'} ws={ws} />;
}

function OrderView({
  id,
  tenant,
  justPlaced,
  ws,
}: {
  id: string;
  tenant: string;
  justPlaced: boolean;
  ws: ReturnType<typeof useWorkspace>;
}) {
  const router = useRouter();
  const refreshOrders = useRefreshOrders();
  const agent = ws.current?.mode === 'agent' && ws.current.tenantId === tenant;
  // Shops read through /shops/me (works for every distributor, even after being blocked).
  const path = agent ? `/t/${tenant}/orders/${id}` : `/shops/me/orders/${id}`;
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api<Order>(path) });
  const [sharing, setSharing] = useState(false);

  const cancel = useMutation({
    mutationFn: () => api<Order>(`/t/${tenant}/orders/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => refreshOrders(),
    onError: (err) => Alert.alert("Couldn't cancel", errorText(err)),
  });

  const reorder = useMutation({
    mutationFn: (shopId: string) =>
      api<{ added: number; skipped: string[] }>(`/t/${tenant}/orders/${id}/reorder`, {
        method: 'POST',
        query: agent ? { shop_id: shopId } : {},
      }),
    onSuccess: async (res, shopId) => {
      // A shop may be reordering from a different distributor than the one selected.
      if (!agent) useSession.getState().chooseShopMode(tenant);
      else if (ws.current?.agentShop?.id !== shopId) {
        useSession.getState().pickAgentShop({ id: shopId, name: order.data!.shop_name });
      }
      await refreshOrders();
      if (res.skipped.length) {
        Alert.alert('Added to cart', `Not available any more, so skipped:\n${res.skipped.join('\n')}`);
      }
      router.navigate('/cart');
    },
    onError: (err) => Alert.alert("Couldn't reorder", errorText(err)),
  });

  async function shareBill(o: Order) {
    setSharing(true);
    try {
      const billPath = agent ? `/t/${tenant}/orders/${id}/bill.pdf` : `/shops/me/orders/${id}/bill.pdf`;
      await downloadAndShare(billPath, `order-${o.order_no}-${o.distributor_name}.pdf`, 'application/pdf', `Order #${o.order_no}`);
    } catch (err) {
      Alert.alert("Couldn't get the bill", errorText(err));
    } finally {
      setSharing(false);
    }
  }

  if (order.isLoading) return <SkeletonList count={4} />;
  if (order.isError) return <ErrorView message={errorText(order.error)} onRetry={() => order.refetch()} />;
  const o = order.data!;
  const changed = o.items.some((i) => i.qty !== i.qty_ordered);

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={order.isRefetching} onRefresh={() => void order.refetch()} />}>
      <Stack.Screen options={{ title: `Order #${o.order_no}` }} />
      {justPlaced && o.status === 'pending' && (
        <Banner kind="ok" text={`Order #${o.order_no} placed. ${o.distributor_name} will confirm it soon.`} />
      )}

      <Card>
        <View style={styles.row}>
          <Text style={styles.title}>{o.distributor_name}</Text>
          <StatusBadge status={o.status} />
        </View>
        <Text style={styles.meta}>
          {dateTime(o.created_at)}
          {o.source !== 'shop' && o.placed_by_name ? ` · placed by ${o.placed_by_name}` : ''}
        </Text>
        <Text style={[styles.meta, { marginTop: space.sm }]}>
          {o.shop_name} · {o.shop_address}
        </Text>
        <OrderProgress status={o.status} />
      </Card>

      <SectionTitle>Items</SectionTitle>
      <Card style={{ paddingVertical: space.sm }}>
        {o.items.map((item, i) => (
          <ItemRow key={item.id} item={item} first={i === 0} />
        ))}
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.total}>{inr(o.items_total)}</Text>
        </View>
      </Card>
      {changed && <Text style={styles.small}>Quantities were changed by the distributor. The total uses the final quantities.</Text>}
      {o.note ? <Text style={[styles.small, { marginTop: space.sm }]}>Note: {o.note}</Text> : null}

      <SectionTitle>History</SectionTitle>
      <Card>
        {o.events.map((e, i) => (
          <View key={`${e.to_status}-${e.at}`} style={styles.event}>
            <View style={styles.eventMarker}>
              <View style={[styles.dot, i === o.events.length - 1 && { backgroundColor: colors.primary }]} />
              {i < o.events.length - 1 && <View style={styles.lineV} />}
            </View>
            <View style={{ flex: 1, paddingBottom: space.md }}>
              <Text style={styles.eventTitle}>{STATUS_LABEL[e.to_status] ?? e.to_status}</Text>
              <Text style={styles.small}>
                {dateTime(e.at)}
                {e.by_name ? ` · ${e.by_name}` : ''}
              </Text>
              {e.note ? <Text style={styles.eventNote}>{e.note}</Text> : null}
            </View>
          </View>
        ))}
      </Card>

      <View style={{ gap: space.md, marginTop: space.xl }}>
        <Button title="Share bill (PDF)" icon="share-outline" onPress={() => shareBill(o)} loading={sharing} />
        <Button title="Order again" icon="repeat-outline" variant="secondary" onPress={() => reorder.mutate(o.shop_id)} loading={reorder.isPending} />
        {o.status === 'pending' && (
          <Button
            title="Cancel order"
            variant="danger"
            loading={cancel.isPending}
            onPress={() =>
              Alert.alert('Cancel this order?', `Order #${o.order_no} will be cancelled.`, [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Cancel order', style: 'destructive', onPress: () => cancel.mutate() },
              ])
            }
          />
        )}
      </View>
    </ScrollView>
  );
}

function ItemRow({ item, first }: { item: OrderItem; first: boolean }) {
  const removed = item.qty === 0;
  return (
    <View style={[styles.item, !first && styles.itemBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemName, removed && styles.struck]}>{item.product_name}</Text>
        <Text style={styles.small}>
          {item.qty} × {packLabel(item.unit_name, item.pieces_per_unit)} @ {inr(item.rate)}
          {item.qty !== item.qty_ordered ? `  (ordered ${item.qty_ordered})` : ''}
        </Text>
      </View>
      {removed ? (
        <Ionicons name="close-circle-outline" size={18} color={colors.muted} />
      ) : (
        <Text style={styles.itemTotal}>{inr(item.line_total)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, flex: 1, marginRight: space.sm },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  small: { fontSize: 12, color: colors.muted, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  itemName: { fontSize: 15, fontWeight: '600', color: colors.text },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  itemTotal: { fontSize: 15, fontWeight: '700', color: colors.text },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, marginTop: space.sm },
  totalLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  total: { fontSize: 20, fontWeight: '800', color: colors.text },
  event: { flexDirection: 'row' },
  eventMarker: { width: 20, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border, marginTop: 4 },
  lineV: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  eventTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  eventNote: {
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: space.sm,
    marginTop: 4,
  },
});
