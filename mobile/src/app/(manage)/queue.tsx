import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Empty, ErrorView, Loading, StatusBadge } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { dateTime, inr } from '@/lib/format';
import { useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { OrderSummary, Page } from '@/lib/types';

const FILTERS = [
  { key: 'pending', label: 'To approve' },
  { key: 'approved', label: 'To dispatch' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'all', label: 'All' },
];

/** Orders queue: waiting orders oldest first, so nobody waits too long. */
export default function QueueScreen() {
  const { tenantId, base } = useManage();
  const params = useLocalSearchParams<{ status?: string }>();
  const router = useRouter();
  // The filter lives in the URL, so the dashboard tiles can open a specific list.
  const status = params.status ?? 'pending';
  const waiting = status === 'pending' || status === 'approved';

  const orders = useQuery({
    queryKey: ['morders', tenantId, status],
    queryFn: () =>
      api<Page<OrderSummary>>(`${base}/orders`, {
        query: { status: status === 'all' ? undefined : status, oldest_first: waiting, limit: 100 },
      }),
    enabled: !!tenantId,
  });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => router.setParams({ status: f.key })} style={[styles.filter, status === f.key && styles.filterActive]}>
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
            <Empty icon="checkmark-done-outline" title="Nothing here" text={waiting ? 'All caught up.' : 'No orders with this status.'} />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/manage/order/[id]', params: { id: item.id } })}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
              <View style={styles.row}>
                <Text style={styles.no}>#{item.order_no}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.shop}>{item.shop_name}</Text>
              <View style={[styles.row, { marginTop: space.sm }]}>
                <Text style={styles.meta}>
                  {dateTime(item.created_at)} · {item.item_count} item{item.item_count === 1 ? '' : 's'}
                  {item.source === 'agent' ? ` · by ${item.placed_by_name}` : item.source === 'admin' ? ' · by office' : ''}
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
  filter: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontWeight: '600', color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  no: { fontSize: 18, fontWeight: '800', color: colors.text },
  shop: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 2 },
  meta: { fontSize: 12, color: colors.muted, flex: 1 },
  total: { fontSize: 17, fontWeight: '800', color: colors.text },
});
