import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, cardStyle } from '@/components/manage/kit';
import { Empty, ErrorView, SkeletonList, StatusBadge } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { hoursSince, inr, timeAgo } from '@/lib/format';
import { useDashboard, useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { OrderSummary, Page } from '@/lib/types';

const FILTERS = [
  { key: 'pending', label: 'To approve', icon: 'time-outline' },
  { key: 'approved', label: 'To dispatch', icon: 'car-outline' },
  { key: 'dispatched', label: 'On the way', icon: 'navigate-outline' },
  { key: 'delivered', label: 'Delivered', icon: 'checkmark-done-outline' },
  { key: 'all', label: 'All', icon: 'list-outline' },
] as const;

/** Orders queue: waiting orders oldest first, so nobody waits too long. */
export default function QueueScreen() {
  const { tenantId, base } = useManage();
  const params = useLocalSearchParams<{ status?: string }>();
  const router = useRouter();
  const dash = useDashboard(tenantId);
  // The filter lives in the URL, so the dashboard can open a specific list.
  const status = params.status ?? 'pending';
  const waiting = status === 'pending' || status === 'approved';
  const counts: Record<string, number | undefined> = { pending: dash.data?.pending_orders, approved: dash.data?.to_dispatch };

  const orders = useQuery({
    queryKey: ['morders', tenantId, status],
    queryFn: () =>
      api<Page<OrderSummary>>(`${base}/orders`, {
        query: { status: status === 'all' ? undefined : status, oldest_first: waiting, limit: 100 },
      }),
    enabled: !!tenantId,
  });
  const items = orders.data?.items ?? [];
  const total = items.reduce((sum, o) => sum + o.items_total, 0);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsBar} contentContainerStyle={styles.tabs}>
          {FILTERS.map((f) => {
            const on = status === f.key;
            const n = counts[f.key];
            return (
              <Pressable key={f.key} onPress={() => router.setParams({ status: f.key })} style={[styles.tab, on && styles.tabOn]}>
                <Ionicons name={f.icon} size={15} color={on ? '#FFFFFF' : colors.muted} />
                <Text style={[styles.tabText, on && { color: '#FFFFFF' }]}>{f.label}</Text>
                {n ? (
                  <View style={[styles.count, on && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                    <Text style={[styles.countText, on && { color: '#FFFFFF' }]}>{n}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {orders.isLoading ? (
        <SkeletonList />
      ) : orders.isError ? (
        <ErrorView message={errorText(orders.error)} onRetry={() => orders.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void Promise.all([orders.refetch(), dash.refetch()])} />}
          ListHeaderComponent={
            items.length ? (
              <Text style={styles.summary}>
                {items.length} order{items.length === 1 ? '' : 's'} · {inr(total)}
                {waiting ? ' · oldest first' : ''}
              </Text>
            ) : undefined
          }
          ListEmptyComponent={
            <Empty
              icon="checkmark-done-circle-outline"
              title={waiting ? 'All caught up' : 'Nothing here'}
              text={waiting ? 'New orders show up here, and on your phone as a notification.' : 'No orders with this status.'}
            />
          }
          renderItem={({ item }) => {
            const hours = hoursSince(item.created_at);
            const late = waiting && hours >= 4;
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/manage/order/[id]', params: { id: item.id } })}
                style={({ pressed }) => [styles.card, late && styles.cardLate, pressed && { opacity: 0.9 }]}>
                <View style={styles.row}>
                  <Avatar name={item.shop_name} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shop} numberOfLines={1}>
                      {item.shop_name}
                    </Text>
                    <Text style={styles.meta}>
                      #{item.order_no} · {item.item_count} item{item.item_count === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Text style={styles.total}>{inr(item.items_total)}</Text>
                </View>
                <View style={styles.footer}>
                  <View style={[styles.when, late && { backgroundColor: colors.errorSoft }]}>
                    <Ionicons name="time-outline" size={12} color={late ? colors.error : colors.muted} />
                    <Text style={[styles.whenText, late && { color: colors.error, fontWeight: '700' }]}>
                      {late ? `Waiting ${timeAgo(item.created_at).replace(' ago', '')}` : timeAgo(item.created_at)}
                    </Text>
                  </View>
                  {item.source !== 'shop' && item.placed_by_name ? (
                    <View style={styles.agent}>
                      <Ionicons name={item.source === 'agent' ? 'briefcase-outline' : 'business-outline'} size={12} color={colors.primaryDark} />
                      <Text style={styles.agentText} numberOfLines={1}>
                        {item.placed_by_name}
                      </Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  {item.status === 'pending' ? (
                    <View style={styles.cta}>
                      <Text style={styles.ctaText}>Review</Text>
                      <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
                    </View>
                  ) : item.status === 'approved' ? (
                    <View style={[styles.cta, { backgroundColor: colors.ok }]}>
                      <Text style={styles.ctaText}>Dispatch</Text>
                      <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
                    </View>
                  ) : (
                    <StatusBadge status={item.status} />
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tabsBar: { flexGrow: 0, flexShrink: 0, height: 58 },
  tabs: { paddingHorizontal: space.lg, gap: space.sm, alignItems: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontWeight: '700', color: colors.text, fontSize: 13 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 11, fontWeight: '800', color: colors.warn },
  summary: { fontSize: 12, color: colors.muted, fontWeight: '600', marginBottom: -4 },
  card: { ...cardStyle, padding: space.md },
  cardLate: { borderColor: '#F5C2C0' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  shop: { fontSize: 16, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  total: { fontSize: 17, fontWeight: '900', color: colors.text },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  when: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  whenText: { fontSize: 12, color: colors.muted },
  agent: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 140 },
  agentText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.primary, borderRadius: radius.sm, paddingLeft: 12, paddingRight: 8, paddingVertical: 6 },
  ctaText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
});
