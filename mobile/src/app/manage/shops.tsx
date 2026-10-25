import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mapsUrl } from '@/components/LocationField';
import { Button, Empty, ErrorView, Loading, SkeletonList, StatusBadge } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { useDashboard, useManage, useMembers, useRefreshManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { TenantShop } from '@/lib/types';

type Filter = 'pending' | 'active' | 'noagent' | 'blocked' | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Waiting' },
  { key: 'active', label: 'Active' },
  { key: 'noagent', label: 'No agent' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'all', label: 'All' },
];

/** Owner/staff: every shop that joined, with approve/block and agent assignment. */
export default function ShopsScreen() {
  const { tenantId, base } = useManage();
  const router = useRouter();
  const dash = useDashboard(tenantId);
  const waiting = dash.data?.shops_waiting ?? 0;
  const [chosen, setChosen] = useState<Filter | null>(null);
  // Open on "Waiting" only when someone is waiting; otherwise show the shops you have.
  const filter: Filter = chosen ?? (waiting > 0 ? 'pending' : 'active');
  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState<TenantShop | null>(null);
  const refresh = useRefreshManage();
  const shops = useQuery({
    queryKey: ['mshops', tenantId, 'all'],
    queryFn: () => api<TenantShop[]>(`${base}/shops`),
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

  if (!tenantId || dash.isLoading) return <Loading />;
  const all = shops.data ?? [];
  const counts: Record<Filter, number> = {
    pending: all.filter((s) => s.status === 'pending').length,
    active: all.filter((s) => s.status === 'active').length,
    noagent: all.filter((s) => s.status === 'active' && !s.agent_user_id).length,
    blocked: all.filter((s) => s.status === 'blocked').length,
    all: all.length,
  };
  const term = search.trim().toLowerCase();
  const list = all
    .filter((s) => (filter === 'all' ? true : filter === 'noagent' ? s.status === 'active' && !s.agent_user_id : s.status === filter))
    .filter((s) => !term || `${s.shop_name} ${s.owner_name} ${s.city} ${s.pincode} ${s.owner_phone}`.toLowerCase().includes(term));

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search shop, owner, city, phone" placeholderTextColor={colors.faint} style={styles.searchInput} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersBar} contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => {
            const on = filter === f.key;
            const alert = (f.key === 'pending' || f.key === 'noagent') && counts[f.key] > 0;
            return (
              <Pressable key={f.key} onPress={() => setChosen(f.key)} style={[styles.filter, on && styles.filterOn]}>
                <Text style={[styles.filterText, on && { color: '#FFFFFF' }]}>{f.label}</Text>
                <View style={[styles.badge, alert && !on && { backgroundColor: colors.warnSoft }, on && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                  <Text style={[styles.badgeText, alert && !on && { color: colors.warn }, on && { color: '#FFFFFF' }]}>{counts[f.key]}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {shops.isLoading ? (
        <SkeletonList />
      ) : shops.isError ? (
        <ErrorView message={errorText(shops.error)} onRetry={() => shops.refetch()} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(s) => s.shop_id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={shops.isRefetching} onRefresh={() => void shops.refetch()} />}
          ListEmptyComponent={
            <Empty
              icon="storefront-outline"
              title={term ? 'No shop matches' : filter === 'pending' ? 'No requests waiting' : filter === 'noagent' ? 'Every shop has an agent' : 'No shops here'}
              text={filter === 'pending' && !term ? 'Shops join with your code or QR; their requests show up here.' : undefined}
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
              {item.last_order_at ? <Text style={styles.meta}>Last order {shortDate(item.last_order_at)}</Text> : null}
              <View style={styles.contact}>
                <Pressable onPress={() => Linking.openURL(`tel:${item.owner_phone}`)} style={styles.inline}>
                  <Ionicons name="call-outline" size={15} color={colors.primary} />
                  <Text style={styles.link}>{item.owner_phone}</Text>
                </Pressable>
                {item.lat != null && item.lng != null && (
                  <Pressable onPress={() => Linking.openURL(mapsUrl(item.lat!, item.lng!))} style={styles.inline}>
                    <Ionicons name="navigate-outline" size={15} color={colors.primary} />
                    <Text style={styles.link}>Map</Text>
                  </Pressable>
                )}
              </View>

              {item.status !== 'blocked' && (
                <Pressable onPress={() => setAssigning(item)} style={[styles.agentBox, !item.agent_user_id && styles.agentBoxEmpty]} accessibilityRole="button">
                  <Ionicons name={item.agent_user_id ? 'person-circle' : 'person-add-outline'} size={22} color={item.agent_user_id ? colors.primary : colors.warn} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.agentLabel}>Agent</Text>
                    <Text style={[styles.agentName, !item.agent_user_id && { color: colors.warn }]}>
                      {item.agent_name ?? 'Not assigned'}
                      {item.added_by_agent ? ' · signed up by agent' : ''}
                    </Text>
                  </View>
                  <Text style={styles.agentAction}>{item.agent_user_id ? 'Change' : 'Assign'}</Text>
                </Pressable>
              )}

              <View style={styles.actions}>
                {item.status !== 'active' && (
                  <Button
                    title={item.status === 'blocked' ? 'Unblock' : 'Approve'}
                    icon="checkmark"
                    onPress={() => act.mutate({ shopId: item.shop_id, action: 'approve' })}
                    style={styles.btn}
                    disabled={act.isPending}
                  />
                )}
                {item.status !== 'blocked' && (
                  <Button
                    title={item.status === 'pending' ? 'Decline' : 'Block'}
                    variant="ghost"
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
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={assigning !== null} transparent animationType="slide" onRequestClose={() => setAssigning(null)}>
        <Pressable style={styles.backdrop} onPress={() => setAssigning(null)} accessibilityLabel="Close" />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Agent for {assigning?.shop_name}</Text>
          <Text style={styles.sheetSub}>The agent can order for this shop and sees its orders.</Text>
          {(agents.data ?? []).map((a) => {
            const on = assigning?.agent_user_id === a.user_id;
            return (
              <Pressable
                key={a.user_id}
                disabled={act.isPending}
                onPress={() => assigning && act.mutate({ shopId: assigning.shop_id, action: 'agent', body: { agent_user_id: a.user_id } })}
                style={[styles.option, on && styles.optionOn]}>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.faint} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionName}>{a.name ?? a.phone}</Text>
                  <Text style={styles.meta}>
                    {a.assigned_shops} shop{a.assigned_shops === 1 ? '' : 's'} · {a.phone}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {!agents.data?.length && <Text style={styles.sheetSub}>No agents yet.</Text>}
          {assigning?.agent_user_id ? (
            <Button title="Remove agent" variant="ghost" onPress={() => act.mutate({ shopId: assigning.shop_id, action: 'agent', body: { agent_user_id: null } })} />
          ) : null}
          <Button
            title="Add a new agent"
            icon="person-add-outline"
            variant="secondary"
            onPress={() => {
              setAssigning(null);
              router.push('/manage/team');
            }}
            style={{ marginTop: space.sm }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingTop: space.md },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minHeight: 42, fontSize: 15, color: colors.text },
  filtersBar: { flexGrow: 0, flexShrink: 0, height: 56 },
  filters: { paddingHorizontal: space.lg, gap: space.sm, alignItems: 'center' },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 14, paddingRight: 6, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  filterOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontWeight: '600', color: colors.text, fontSize: 13 },
  badge: { minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, fontWeight: '800', color: colors.muted },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: '#EEF0F3' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1, marginRight: space.sm },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  contact: { flexDirection: 'row', columnGap: space.lg, flexWrap: 'wrap' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  link: { color: colors.primary, fontWeight: '700' },
  agentBox: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  agentBoxEmpty: { backgroundColor: colors.warnSoft },
  agentLabel: { fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  agentName: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 1 },
  agentAction: { fontSize: 14, fontWeight: '800', color: colors.primary },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap', justifyContent: 'flex-end' },
  btn: { minHeight: 40, paddingHorizontal: space.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, paddingTop: space.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.md },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sheetSub: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: space.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: space.sm },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionName: { fontSize: 15, fontWeight: '700', color: colors.text },
});
