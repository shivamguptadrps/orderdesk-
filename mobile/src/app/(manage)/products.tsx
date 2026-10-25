import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { cardStyle } from '@/components/manage/kit';
import { Empty, ErrorView, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { inr, mediaUrl, packName } from '@/lib/format';
import { useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { ManageProduct, Page } from '@/lib/types';

type Filter = 'all' | 'active' | 'hidden' | 'low' | 'out';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'On sale' },
  { key: 'low', label: 'Low stock' },
  { key: 'out', label: 'Out of stock' },
  { key: 'hidden', label: 'Hidden' },
];

function mainUnit(p: ManageProduct) {
  return p.units.find((u) => u.is_default) ?? p.units[0];
}

/** Low = fewer than 2 of the main pack left (same rule as the dashboard). */
function stockLevel(p: ManageProduct): 'out' | 'low' | 'ok' {
  if (p.stock_pieces <= 0) return 'out';
  const u = mainUnit(p);
  return p.stock_pieces < 2 * (u?.pieces_per_unit ?? 1) ? 'low' : 'ok';
}

function stockLabel(p: ManageProduct) {
  const u = mainUnit(p);
  if (p.stock_pieces <= 0) return 'Out of stock';
  if (!u || u.pieces_per_unit === 1) return `${p.stock_pieces} pcs`;
  return `${Math.floor(p.stock_pieces / u.pieces_per_unit)} ${u.name.replace(/\s*\(\d+\)$/, '')} · ${p.stock_pieces} pcs`;
}

const LEVEL = {
  ok: { bg: colors.okSoft, fg: colors.ok, icon: 'checkmark-circle' as const },
  low: { bg: colors.warnSoft, fg: colors.warn, icon: 'alert-circle' as const },
  out: { bg: colors.errorSoft, fg: colors.error, icon: 'close-circle' as const },
};

export default function ProductsScreen() {
  const { tenantId, base } = useManage();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const products = useQuery({
    queryKey: ['mproducts', tenantId, q, 'all'],
    queryFn: () => api<Page<ManageProduct>>(`${base}/products`, { query: { q, limit: 200 } }),
    enabled: !!tenantId,
  });

  const all = products.data?.items ?? [];
  const match = (p: ManageProduct, f: Filter) =>
    f === 'all' ? true : f === 'active' || f === 'hidden' ? p.status === f : p.status === 'active' && stockLevel(p) === f;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, all.filter((p) => match(p, f.key)).length])) as Record<Filter, number>;
  const list = all.filter((p) => match(p, filter));

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search name, brand, SKU" placeholderTextColor={colors.faint} style={styles.searchInput} autoCorrect={false} />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.faint} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersBar} contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => {
            const on = filter === f.key;
            const warn = (f.key === 'low' || f.key === 'out') && counts[f.key] > 0;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.filter, on && styles.filterOn]}>
                <Text style={[styles.filterText, on && { color: '#FFFFFF' }]}>{f.label}</Text>
                <View style={[styles.badge, warn && !on && { backgroundColor: f.key === 'out' ? colors.errorSoft : colors.warnSoft }, on && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                  <Text style={[styles.badgeText, warn && !on && { color: f.key === 'out' ? colors.error : colors.warn }, on && { color: '#FFFFFF' }]}>{counts[f.key]}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {products.isLoading ? (
        <SkeletonList />
      ) : products.isError ? (
        <ErrorView message={errorText(products.error)} onRetry={() => products.refetch()} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 110, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={products.isRefetching} onRefresh={() => void products.refetch()} />}
          ListEmptyComponent={
            <Empty
              icon="cube-outline"
              title={q ? 'No match' : filter === 'all' ? 'No products yet' : 'Nothing here'}
              text={q ? `Nothing matches “${q}”.` : filter === 'all' ? 'Tap “Add product” to create your first one, or use Excel import.' : undefined}
            />
          }
          renderItem={({ item }) => {
            const unit = mainUnit(item);
            const level = LEVEL[stockLevel(item)];
            const hidden = item.status === 'hidden';
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/manage/product/[id]', params: { id: item.id } })}
                style={({ pressed }) => [styles.card, hidden && { opacity: 0.7 }, pressed && { opacity: 0.85 }]}>
                <View style={styles.thumb}>
                  {item.thumbnails[0] ? (
                    <Image source={{ uri: mediaUrl(item.thumbnails[0]) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Ionicons name="cube-outline" size={24} color={colors.faint} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {unit ? (
                      <>
                        <Text style={styles.price}>{inr(unit.price)}</Text> / {packName(unit.name, unit.pieces_per_unit)}
                        {item.units.length > 1 ? ` · +${item.units.length - 1} pack${item.units.length > 2 ? 's' : ''}` : ''}
                      </>
                    ) : (
                      'No pack size yet'
                    )}
                  </Text>
                  <View style={styles.pills}>
                    <View style={[styles.pill, { backgroundColor: level.bg }]}>
                      <Ionicons name={level.icon} size={12} color={level.fg} />
                      <Text style={[styles.pillText, { color: level.fg }]} numberOfLines={1}>
                        {stockLabel(item)}
                      </Text>
                    </View>
                    {hidden && (
                      <View style={[styles.pill, { backgroundColor: '#EEF1F4' }]}>
                        <Ionicons name="eye-off" size={12} color={colors.muted} />
                        <Text style={[styles.pillText, { color: colors.muted }]}>Hidden</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        onPress={() => router.push({ pathname: '/manage/product/[id]', params: { id: 'new' } })}
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.96 }] }]}
        accessibilityRole="button"
        accessibilityLabel="Add product">
        <Ionicons name="add" size={22} color="#FFFFFF" />
        <Text style={styles.fabText}>Add product</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { backgroundColor: colors.card, paddingTop: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minHeight: 44, fontSize: 15, color: colors.text },
  filtersBar: { flexGrow: 0, flexShrink: 0, height: 56 },
  filters: { paddingHorizontal: space.lg, gap: space.sm, alignItems: 'center' },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 6, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  filterOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontWeight: '700', color: colors.text, fontSize: 13 },
  badge: { minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, fontWeight: '800', color: colors.muted },
  card: { ...cardStyle, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  thumb: { width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: colors.text, lineHeight: 19 },
  meta: { fontSize: 12, color: colors.muted },
  price: { fontSize: 14, fontWeight: '800', color: colors.text },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, maxWidth: '100%' },
  pillText: { fontSize: 11, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
