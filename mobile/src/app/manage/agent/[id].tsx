import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Empty, ErrorView, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useManage, useRefreshManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { TenantShop } from '@/lib/types';

/** Owner/staff: tick the shops this agent looks after. Ticking a shop moves it from any other agent. */
export default function AgentShopsScreen() {
  const { id, name, fresh } = useLocalSearchParams<{ id: string; name?: string; fresh?: string }>();
  const { tenantId, base } = useManage();
  const router = useRouter();
  const refresh = useRefreshManage();
  const shops = useQuery({
    queryKey: ['mshops', tenantId, 'all'],
    queryFn: () => api<TenantShop[]>(`${base}/shops`),
    enabled: !!tenantId,
  });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState('');

  const list = useMemo(
    () => (shops.data ?? []).filter((s) => s.status !== 'blocked').sort((a, b) => a.shop_name.localeCompare(b.shop_name)),
    [shops.data],
  );
  const original = useMemo(() => new Set(list.filter((s) => s.agent_user_id === id).map((s) => s.shop_id)), [list, id]);
  const selected = picked ?? original;
  const term = search.trim().toLowerCase();
  const shown = term ? list.filter((s) => `${s.shop_name} ${s.city} ${s.owner_name} ${s.pincode}`.toLowerCase().includes(term)) : list;
  const moving = list.filter((s) => selected.has(s.shop_id) && s.agent_user_id && s.agent_user_id !== id);
  const changed = selected.size !== original.size || [...selected].some((s) => !original.has(s));

  const save = useMutation({
    mutationFn: () => api<TenantShop[]>(`${base}/members/${id}/shops`, { method: 'PUT', body: { shop_ids: [...selected] } }),
    onSuccess: async () => {
      await refresh();
      router.back();
    },
    onError: (err) => Alert.alert("Couldn't save", errorText(err)),
  });

  function toggle(shopId: string) {
    const next = new Set(selected);
    if (next.has(shopId)) next.delete(shopId);
    else next.add(shopId);
    setPicked(next);
  }

  const allShownPicked = shown.length > 0 && shown.every((s) => selected.has(s.shop_id));

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <Stack.Screen options={{ title: name ? `Shops for ${name}` : 'Assign shops' }} />
      {shops.isLoading ? (
        <SkeletonList />
      ) : shops.isError ? (
        <ErrorView message={errorText(shops.error)} onRetry={() => shops.refetch()} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(s) => s.shop_id}
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl, gap: space.sm, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: space.md, marginBottom: space.sm }}>
              {fresh === '1' && <Banner kind="ok" text={`${name ?? 'The agent'} is added. Now tick the shops they visit; they will see only these.`} />}
              <Text style={styles.help}>
                {name ?? 'This agent'} can see and order only for the ticked shops. A shop has one agent; ticking a shop that another agent has
                moves it here.
              </Text>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color={colors.muted} />
                <TextInput value={search} onChangeText={setSearch} placeholder="Search shop, city, pincode" placeholderTextColor={colors.faint} style={styles.searchInput} />
              </View>
              <View style={styles.bulk}>
                <Text style={styles.count}>
                  {selected.size} of {list.length} shops ticked
                </Text>
                <Pressable
                  onPress={() => {
                    const next = new Set(selected);
                    shown.forEach((s) => (allShownPicked ? next.delete(s.shop_id) : next.add(s.shop_id)));
                    setPicked(next);
                  }}
                  hitSlop={8}>
                  <Text style={styles.link}>{allShownPicked ? 'Untick all' : term ? 'Tick these' : 'Tick all'}</Text>
                </Pressable>
              </View>
            </View>
          }
          ListEmptyComponent={<Empty icon="storefront-outline" title={term ? 'No shop matches' : 'No shops yet'} text={term ? undefined : 'Shops appear here once they join with your code.'} />}
          renderItem={({ item }) => {
            const on = selected.has(item.shop_id);
            const other = item.agent_user_id && item.agent_user_id !== id ? item.agent_name : null;
            return (
              <Pressable onPress={() => toggle(item.shop_id)} style={[styles.row, on && styles.rowOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <View style={[styles.box, on && styles.boxOn]}>{on && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.shop_name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.city} - {item.pincode} · {item.owner_name}
                    {item.status === 'pending' ? ' · waiting approval' : ''}
                  </Text>
                  {other ? (
                    <Text style={[styles.meta, { color: on ? colors.warn : colors.muted, fontWeight: '600' }]}>
                      {on ? `Moves from ${other}` : `With ${other}`}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
      <View style={styles.footer}>
        {moving.length > 0 && (
          <Text style={styles.warn}>
            {moving.length} shop{moving.length === 1 ? '' : 's'} will move from {[...new Set(moving.map((s) => s.agent_name))].join(', ')}.
          </Text>
        )}
        <Button
          title={changed ? `Save · ${selected.size} shop${selected.size === 1 ? '' : 's'}` : 'No changes'}
          icon="checkmark"
          onPress={() => save.mutate()}
          loading={save.isPending}
          disabled={!changed}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  searchInput: { flex: 1, minHeight: 44, fontSize: 15, color: colors.text },
  bulk: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  link: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  footer: { padding: space.lg, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: space.sm },
  warn: { fontSize: 12, color: colors.warn, fontWeight: '600', textAlign: 'center' },
});
