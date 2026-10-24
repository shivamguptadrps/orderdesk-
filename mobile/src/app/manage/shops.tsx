import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Empty, ErrorView, Loading, StatusBadge } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { useManage, useMembers, useRefreshManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { TenantShop } from '@/lib/types';

const FILTERS = [
  { key: 'pending', label: 'Waiting' },
  { key: 'active', label: 'Active' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'all', label: 'All' },
];

export default function ShopsScreen() {
  const { tenantId, base } = useManage();
  const [status, setStatus] = useState('pending');
  const [assigning, setAssigning] = useState<string | null>(null);
  const refresh = useRefreshManage();
  const shops = useQuery({
    queryKey: ['mshops', tenantId, status],
    queryFn: () => api<TenantShop[]>(`${base}/shops`, { query: { status: status === 'all' ? undefined : status } }),
    enabled: !!tenantId,
  });
  const agents = useMembers(tenantId, 'agent');

  const act = useMutation({
    mutationFn: ({ shopId, action, body }: { shopId: string; action: 'approve' | 'block' | 'agent'; body?: unknown }) =>
      action === 'agent'
        ? api(`${base}/shops/${shopId}/agent`, { method: 'PUT', body })
        : api(`${base}/shops/${shopId}/${action}`, { method: 'POST' }),
    onSuccess: async () => {
      setAssigning(null);
      await refresh();
    },
    onError: (err) => Alert.alert("Couldn't update shop", errorText(err)),
  });

  if (!tenantId) return <Loading />;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setStatus(f.key)} style={[styles.filter, status === f.key && styles.filterActive]}>
            <Text style={[styles.filterText, status === f.key && { color: '#FFFFFF' }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {shops.isLoading ? (
        <Loading />
      ) : shops.isError ? (
        <ErrorView message={errorText(shops.error)} onRetry={() => shops.refetch()} />
      ) : (
        <FlatList
          data={shops.data ?? []}
          keyExtractor={(s) => s.shop_id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={shops.isRefetching} onRefresh={() => void shops.refetch()} />}
          ListEmptyComponent={
            <Empty
              icon="storefront-outline"
              title={status === 'pending' ? 'No requests waiting' : 'No shops here'}
              text={status === 'pending' ? 'Shops join with your code; their requests show up here.' : undefined}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name}>{item.shop_name}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.meta}>
                {item.owner_name} · {item.address}, {item.city} - {item.pincode}
              </Text>
              <Pressable onPress={() => Linking.openURL(`tel:${item.owner_phone}`)} style={styles.inline}>
                <Ionicons name="call-outline" size={15} color={colors.primary} />
                <Text style={styles.link}>{item.owner_phone}</Text>
              </Pressable>
              <Text style={styles.meta}>
                {item.agent_name ? `Agent: ${item.agent_name}` : 'No agent'}
                {item.added_by_agent ? ' · signed up by agent' : ''}
                {item.last_order_at ? ` · last order ${shortDate(item.last_order_at)}` : ''}
              </Text>

              <View style={styles.actions}>
                {item.status !== 'active' && (
                  <Button
                    title={item.status === 'blocked' ? 'Unblock' : 'Approve'}
                    onPress={() => act.mutate({ shopId: item.shop_id, action: 'approve' })}
                    style={styles.btn}
                    disabled={act.isPending}
                  />
                )}
                {item.status !== 'blocked' && (
                  <Button
                    title={item.status === 'pending' ? 'Decline' : 'Block'}
                    variant="danger"
                    style={styles.btn}
                    disabled={act.isPending}
                    onPress={() =>
                      Alert.alert(
                        `${item.status === 'pending' ? 'Decline' : 'Block'} ${item.shop_name}?`,
                        'They will not be able to order from you. You can unblock later.',
                        [
                          { text: 'Back', style: 'cancel' },
                          { text: 'Yes', style: 'destructive', onPress: () => act.mutate({ shopId: item.shop_id, action: 'block' }) },
                        ],
                      )
                    }
                  />
                )}
                <Button
                  title="Agent"
                  icon="person-outline"
                  variant="secondary"
                  style={styles.btn}
                  onPress={() => setAssigning(assigning === item.shop_id ? null : item.shop_id)}
                />
              </View>

              {assigning === item.shop_id && (
                <View style={styles.agentList}>
                  {(agents.data ?? []).map((a) => (
                    <Pressable
                      key={a.user_id}
                      onPress={() => act.mutate({ shopId: item.shop_id, action: 'agent', body: { agent_user_id: a.user_id } })}
                      style={styles.agentRow}>
                      <Text style={styles.agentName}>{a.name ?? a.phone}</Text>
                      <Text style={styles.meta}>{a.assigned_shops} shops</Text>
                    </Pressable>
                  ))}
                  {item.agent_user_id && (
                    <Pressable onPress={() => act.mutate({ shopId: item.shop_id, action: 'agent', body: { agent_user_id: null } })} style={styles.agentRow}>
                      <Text style={[styles.agentName, { color: colors.error }]}>Remove agent</Text>
                    </Pressable>
                  )}
                  {!agents.data?.length && <Text style={styles.meta}>No agents yet. Add them under More › Team.</Text>}
                </View>
              )}
            </View>
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
  name: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1, marginRight: space.sm },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  link: { color: colors.primary, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },
  btn: { minHeight: 40, paddingHorizontal: space.md },
  agentList: { marginTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  agentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  agentName: { fontSize: 15, fontWeight: '600', color: colors.text },
});
