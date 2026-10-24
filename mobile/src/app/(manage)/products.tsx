import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Empty, ErrorView, Loading } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { inr, mediaUrl, packLabel } from '@/lib/format';
import { stockText, useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { ManageProduct, Page } from '@/lib/types';

const STATUS = [
  { key: undefined, label: 'All' },
  { key: 'active', label: 'On sale' },
  { key: 'hidden', label: 'Hidden' },
] as const;

export default function ProductsScreen() {
  const { tenantId, base } = useManage();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'hidden' | undefined>(undefined);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const products = useQuery({
    queryKey: ['mproducts', tenantId, q, status],
    queryFn: () => api<Page<ManageProduct>>(`${base}/products`, { query: { q, status, limit: 200 } }),
    enabled: !!tenantId,
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products"
            placeholderTextColor={colors.faint}
            style={styles.searchInput}
            autoCorrect={false}
          />
        </View>
        <Button title="Add" icon="add" onPress={() => router.push({ pathname: '/manage/product/[id]', params: { id: 'new' } })} />
      </View>
      <View style={styles.filters}>
        {STATUS.map((s) => (
          <Pressable key={s.label} onPress={() => setStatus(s.key)} style={[styles.filter, status === s.key && styles.filterActive]}>
            <Text style={[styles.filterText, status === s.key && { color: '#FFFFFF' }]}>{s.label}</Text>
          </Pressable>
        ))}
        <Text style={styles.count}>{products.data ? `${products.data.total} products` : ''}</Text>
      </View>
      {products.isLoading ? (
        <Loading />
      ) : products.isError ? (
        <ErrorView message={errorText(products.error)} onRetry={() => products.refetch()} />
      ) : (
        <FlatList
          data={products.data?.items ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.sm, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={products.isRefetching} onRefresh={() => void products.refetch()} />}
          ListEmptyComponent={<Empty icon="cube-outline" title="No products" text={q ? `Nothing matches "${q}".` : 'Tap Add to create your first product.'} />}
          renderItem={({ item }) => {
            const unit = item.units.find((u) => u.is_default) ?? item.units[0];
            const out = item.stock_pieces === 0;
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/manage/product/[id]', params: { id: item.id } })}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
                <View style={styles.thumb}>
                  {item.thumbnails[0] ? (
                    <Image source={{ uri: mediaUrl(item.thumbnails[0]) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Ionicons name="cube-outline" size={22} color={colors.faint} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {unit ? `${inr(unit.price)} / ${packLabel(unit.name, unit.pieces_per_unit)}` : 'No pack size'}
                    {item.status === 'hidden' ? ' · hidden' : ''}
                  </Text>
                  <Text style={[styles.stock, out && { color: colors.error }]}>{out ? 'Out of stock' : `Stock: ${stockText(item)}`}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', gap: space.sm, padding: space.lg, paddingBottom: space.sm, alignItems: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, minHeight: 44, fontSize: 16, color: colors.text },
  filters: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md, alignItems: 'center' },
  filter: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontWeight: '600', color: colors.text, fontSize: 13 },
  count: { marginLeft: 'auto', color: colors.muted, fontSize: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  stock: { fontSize: 12, color: colors.ok, fontWeight: '600', marginTop: 2 },
});
