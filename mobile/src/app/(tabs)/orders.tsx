import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Empty, ErrorView, Loading, StatusBadge } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useWorkspace } from '@/lib/data';
import { dateTime, inr } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';
import type { OrderSummary, Page } from '@/lib/types';

const FILTERS: { key: string | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'delivered', label: 'Delivered' },
];

export default function OrdersScreen() {
  const ws = useWorkspace();
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const current = ws.current;
  const agent = current?.mode === 'agent';

  const orders = useQuery({
    queryKey: ['orders', agent ? `agent:${current?.tenantId}` : 'mine', status],
    // Shops see orders from every distributor; agents see their distributor's orders for their shops.
    queryFn: () =>
      agent
        ? api<Page<OrderSummary>>(`/t/${current!.tenantId}/orders`, { query: { status, limit: 100 } })
        : api<Page<OrderSummary>>('/shops/me/orders', { query: { status, limit: 100 } }),
    enabled: !ws.loading && (agent || !!ws.me.data?.shop),
  });

  if (ws.loading) return <Loading />;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable key={f.label} onPress={() => setStatus(f.key)} style={[styles.filter, status === f.key && styles.filterActive]}>
            <Text style={[styles.filterText, status === f.key && { color: '#FFFFFF' }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {orders.isLoading ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorView message={errorText(orders.error)} onRetry={() => orders.refetch()} />
      ) : (
        <FlatList
          data={orders.data?.items ?? []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} />}
          ListEmptyComponent={
            <Empty icon="receipt-outline" title="No orders yet" text={status ? 'No orders with this status.' : 'Orders you place will show up here.'} />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id, tenant: item.tenant_id } })}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
              <View style={styles.row}>
                <Text style={styles.no}>Order #{item.order_no}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.who}>{agent ? item.shop_name : item.distributor_name}</Text>
              <View style={[styles.row, { marginTop: space.sm }]}>
                <Text style={styles.meta}>
                  {dateTime(item.created_at)} · {item.item_count} item{item.item_count === 1 ? '' : 's'}
                  {item.source !== 'shop' && item.placed_by_name ? ` · by ${item.placed_by_name}` : ''}
                </Text>
                <Text style={styles.total}>{inr(item.items_total)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filters: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  filter: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontWeight: '600', color: colors.text },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  no: { fontSize: 17, fontWeight: '800', color: colors.text },
  who: { fontSize: 14, color: colors.muted, marginTop: 2 },
  meta: { fontSize: 12, color: colors.muted, flex: 1 },
  total: { fontSize: 17, fontWeight: '800', color: colors.text },
});
