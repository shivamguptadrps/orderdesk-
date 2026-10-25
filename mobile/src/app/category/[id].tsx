import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CartBar } from '@/components/shop/CartBar';
import { categoryLook } from '@/components/shop/categoryLook';
import { ProductTile } from '@/components/shop/ProductTile';
import { SizeSheet } from '@/components/shop/SizeSheet';
import { Empty, ErrorView, Loading, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useCartActions } from '@/lib/cartActions';
import { useCart, useWorkspace, type Workspace } from '@/lib/data';
import { gridColumns, mediaUrl, saving } from '@/lib/format';
import { colors, space } from '@/lib/theme';
import type { CatalogCard, CategoryNode, Page } from '@/lib/types';

const RAIL = 86;

type Sort = 'relevance' | 'price_asc' | 'price_desc' | 'discount';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'price_desc', label: 'Price: high to low' },
  { key: 'discount', label: 'Biggest discount' },
];

/**
 * Category page. Same layout for every category: main categories down the left (as on Home),
 * sub-categories as chips on top (if any), products in a grid, with sorting.
 */
export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useWorkspace();
  if (ws.loading) return <Loading />;
  if (!ws.current) return <ErrorView message="Choose a distributor first." />;
  return <CategoryView initialId={id} ws={ws.current} />;
}

function locate(tree: CategoryNode[], id: string): { top: CategoryNode; sub: CategoryNode | null } | null {
  for (const top of tree) {
    if (top.id === id) return { top, sub: null };
    const sub = top.children.find((c) => c.id === id);
    if (sub) return { top, sub };
  }
  return null;
}

function discount(p: CatalogCard) {
  return saving(p.mrp, p.default_unit.price, p.default_unit.pieces_per_unit)?.percent ?? 0;
}

function CategoryView({ initialId, ws }: { initialId: string; ws: Workspace }) {
  const router = useRouter();
  const base = `/t/${ws.tenantId}`;
  const cart = useCart(ws);
  const actions = useCartActions(ws);
  const tree = useQuery({ queryKey: ['categories', ws.tenantId], queryFn: () => api<CategoryNode[]>(`${base}/catalog/categories`) });
  const start = useMemo(() => (tree.data ? locate(tree.data, initialId) : null), [tree.data, initialId]);
  const [topId, setTopId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null | undefined>(undefined); // undefined = as opened
  const [sort, setSort] = useState<Sort>('relevance');
  const [sizesOf, setSizesOf] = useState<CatalogCard | null>(null);

  const top = tree.data?.find((c) => c.id === (topId ?? start?.top.id)) ?? null;
  const sub = subId === undefined ? (topId ? null : (start?.sub?.id ?? null)) : subId;
  const categoryId = sub ?? top?.id;

  const products = useQuery({
    queryKey: ['products', ws.tenantId, categoryId, ''],
    queryFn: () => api<Page<CatalogCard>>(`${base}/catalog/products`, { query: { category_id: categoryId, limit: 100, group_variants: true } }),
    enabled: !!categoryId,
  });
  const { width } = useWindowDimensions();
  const cols = gridColumns(Math.min(width, 1080) - RAIL - 16);
  const lines = useMemo(() => new Map((cart.data?.items ?? []).map((l) => [l.unit_id, l])), [cart.data]);
  const sorted = useMemo(() => {
    const list = [...(products.data?.items ?? [])];
    const price = (p: CatalogCard) => p.default_unit.price;
    if (sort === 'price_asc') list.sort((a, b) => price(a) - price(b));
    if (sort === 'price_desc') list.sort((a, b) => price(b) - price(a));
    if (sort === 'discount') list.sort((a, b) => discount(b) - discount(a));
    // out-of-stock items always last
    return list.sort((a, b) => Number(b.in_stock) - Number(a.in_stock));
  }, [products.data, sort]);

  if (tree.isLoading) return <Loading />;
  if (tree.isError) return <ErrorView message={errorText(tree.error)} onRetry={() => tree.refetch()} />;
  if (!top) return <Empty icon="folder-open-outline" title="Category not found" text="It may have been removed." />;

  const topIndex = tree.data!.findIndex((c) => c.id === top.id);
  const look = categoryLook(top.name, topIndex);

  function chooseSort() {
    const labels = SORTS.map((s) => s.label);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: [...labels, 'Cancel'], cancelButtonIndex: labels.length, title: 'Sort by' }, (i) => {
        if (i < labels.length) setSort(SORTS[i].key);
      });
    } else {
      Alert.alert('Sort by', undefined, [...SORTS.map((s) => ({ text: s.label, onPress: () => setSort(s.key) })), { text: 'Cancel', style: 'cancel' as const }]);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.card }}>
      <Stack.Screen options={{ title: top.name }} />
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <ScrollView style={styles.rail} contentContainerStyle={{ paddingVertical: space.sm, paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
          {tree.data!.map((c, i) => {
            const l = categoryLook(c.name, i);
            const active = c.id === top.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  setTopId(c.id);
                  setSubId(null);
                }}
                style={styles.railItem}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}>
                {active && <View style={[styles.railBar, { backgroundColor: l.fg }]} />}
                <View style={[styles.railIcon, { backgroundColor: l.bg }, active && { borderColor: l.fg }]}>
                  {c.image_url ? (
                    <Image source={{ uri: mediaUrl(c.image_url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Ionicons name={l.icon} size={24} color={l.fg} />
                  )}
                </View>
                <Text style={[styles.railName, active && { color: colors.text, fontWeight: '800' }]} numberOfLines={2}>
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {top.children.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsBar} contentContainerStyle={styles.chips}>
              {[{ id: null as string | null, name: 'All' }, ...top.children].map((c) => {
                const on = sub === c.id;
                return (
                  <Pressable
                    key={c.id ?? 'all'}
                    onPress={() => setSubId(c.id)}
                    style={[styles.chip, on && { backgroundColor: look.bg, borderColor: look.fg }]}>
                    <Text style={[styles.chipText, on && { color: look.fg, fontWeight: '800' }]}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <View style={styles.toolbar}>
            <Text style={styles.count}>
              {products.data ? `${products.data.total} item${products.data.total === 1 ? '' : 's'}` : ' '}
            </Text>
            <Pressable onPress={chooseSort} style={styles.sortBtn} accessibilityRole="button" accessibilityLabel="Sort">
              <Ionicons name="swap-vertical" size={14} color={colors.text} />
              <Text style={styles.sortText}>{sort === 'relevance' ? 'Sort' : SORTS.find((s) => s.key === sort)!.label}</Text>
            </Pressable>
          </View>

          {products.isError ? (
            <ErrorView message={errorText(products.error)} onRetry={() => products.refetch()} />
          ) : (
            <FlatList
              data={sorted}
              keyExtractor={(p) => p.id}
              key={`grid-${cols}`}
              numColumns={cols}
              columnWrapperStyle={{ gap: 8, paddingHorizontal: 8 }}
              contentContainerStyle={{ gap: 10, paddingBottom: 110, flexGrow: 1 }}
              refreshControl={<RefreshControl refreshing={products.isRefetching} onRefresh={() => void products.refetch()} />}
              ListEmptyComponent={
                products.isLoading ? (
                  <SkeletonList variant="grid" count={4} />
                ) : (
                  <Empty icon="cube-outline" title="Nothing here yet" text="Try another category." />
                )
              }
              renderItem={({ item }) => (
                <ProductTile
                  columns={cols}
                  p={item}
                  line={lines.get(item.default_unit.id)}
                  busy={actions.busy === item.id}
                  locked={ws.mode === 'agent' && !ws.agentShop}
                  onOpen={() => router.push(`/product/${item.id}`)}
                  onAdd={() => actions.add(item.id, item.default_unit, undefined, item.name)}
                  onChooseSize={() => setSizesOf(item)}
                  onQty={(qty) => {
                    const line = lines.get(item.default_unit.id);
                    if (line) actions.setQty(item.id, line, qty);
                  }}
                />
              )}
            />
          )}
        </View>
      </View>
      <CartBar ws={ws} />
      {sizesOf && <SizeSheet ws={ws} product={sizesOf} onClose={() => setSizesOf(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: RAIL, flexGrow: 0, backgroundColor: colors.card, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  railItem: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  railBar: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  railIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  railName: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 5, lineHeight: 14 },
  chipsBar: { flexGrow: 0, flexShrink: 0, height: 54, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  chips: { paddingHorizontal: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 8 },
  count: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  sortText: { fontSize: 12, fontWeight: '700', color: colors.text },
});
