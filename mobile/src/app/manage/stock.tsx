import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Empty, ErrorView, Loading } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { stockText, useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { ManageProduct, Page } from '@/lib/types';

/** Products running out: less than 2 of their main pack. Or every product, lowest stock first. */
export default function LowStockScreen() {
  const { tenantId, base } = useManage();
  const router = useRouter();
  const [all, setAll] = useState(false);
  const list = useQuery({
    queryKey: ['mproducts', tenantId, 'stock', all],
    queryFn: () => api<Page<ManageProduct>>(`${base}/products`, { query: { low_stock: !all, sort: 'stock', limit: 200 } }),
    enabled: !!tenantId,
  });

  if (list.isLoading) return <Loading />;
  if (list.isError) return <ErrorView message={errorText(list.error)} onRetry={() => list.refetch()} />;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.toggle}>
        {[false, true].map((v) => (
          <Pressable key={String(v)} onPress={() => setAll(v)} style={[styles.tab, all === v && styles.tabActive]}>
            <Text style={[styles.tabText, all === v && { color: '#FFFFFF' }]}>{v ? 'All by stock' : 'Running low'}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={list.data?.items ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.sm, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
        ListEmptyComponent={<Empty icon="checkmark-circle-outline" title="Stock looks fine" text="No product has less than 2 of its main pack." />}
        renderItem={({ item }) => {
          const out = item.stock_pieces === 0;
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/manage/product/[id]', params: { id: item.id } })}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
              <Ionicons name={out ? 'close-circle' : 'alert-circle'} size={22} color={out ? colors.error : colors.warn} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.stock, { color: out ? colors.error : colors.warn }]}>{out ? 'Out of stock' : stockText(item)}</Text>
              </View>
              <Text style={styles.add}>Add stock</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', gap: space.sm, padding: space.lg },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.card },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontWeight: '700', color: colors.text },
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
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  stock: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  add: { color: colors.primary, fontWeight: '700' },
});
