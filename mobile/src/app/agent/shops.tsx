import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Empty, ErrorView, Loading, StatusBadge } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAgentShops, useWorkspace } from '@/lib/data';
import { shortDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';
import type { AgentShop } from '@/lib/types';

/** Agent: pick the shop to order for. */
export default function AgentShopsScreen() {
  const ws = useWorkspace();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const tenantId = ws.current?.mode === 'agent' ? ws.current.tenantId : ws.agentOptions[0]?.tenantId;
  const shops = useAgentShops(tenantId);

  if (ws.loading) return <Loading />;
  if (!tenantId) return <Empty icon="briefcase-outline" title="You are not an agent" text="A distributor can add you as their agent." />;

  function pick(s: AgentShop) {
    const session = useSession.getState();
    session.chooseAgentMode(tenantId!);
    session.pickAgentShop({ id: s.shop_id, name: s.shop_name });
    router.navigate('/home');
  }

  const term = search.trim().toLowerCase();
  const list = (shops.data ?? []).filter(
    (s) => !term || `${s.shop_name} ${s.owner_name} ${s.city} ${s.owner_phone}`.toLowerCase().includes(term),
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search shop, owner, city"
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
        />
      </View>
      {shops.isLoading ? (
        <Loading />
      ) : shops.isError ? (
        <ErrorView message={errorText(shops.error)} onRetry={() => shops.refetch()} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(s) => s.shop_id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={shops.isRefetching} onRefresh={() => void shops.refetch()} />}
          ListEmptyComponent={
            <Empty
              icon="storefront-outline"
              title={term ? 'No match' : 'No shops assigned yet'}
              text={term ? undefined : 'Your distributor assigns shops to you, or sign up a new shop below.'}
            />
          }
          renderItem={({ item }) => {
            const active = item.status === 'active';
            const selected = ws.current?.agentShop?.id === item.shop_id;
            return (
              <Pressable
                disabled={!active}
                onPress={() => pick(item)}
                style={({ pressed }) => [styles.card, selected && styles.selected, !active && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}>
                <View style={styles.row}>
                  <Text style={styles.name}>{item.shop_name}</Text>
                  {active ? (selected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null) : <StatusBadge status={item.status} />}
                </View>
                <Text style={styles.meta}>
                  {item.owner_name} · {item.owner_phone}
                </Text>
                <Text style={styles.meta}>
                  {item.address}, {item.city}
                </Text>
                <Text style={[styles.meta, { marginTop: 4 }]}>
                  {item.last_order_at ? `Last order ${shortDate(item.last_order_at)}` : 'No orders yet'}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
      <View style={styles.footer}>
        <Button title="Sign up a new shop" icon="add" variant="secondary" onPress={() => router.push('/agent/add-shop')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    margin: space.lg,
    marginBottom: 0,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, minHeight: 44, fontSize: 16, color: colors.text },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  selected: { borderColor: colors.primary },
  name: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1 },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  footer: { padding: space.lg, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
