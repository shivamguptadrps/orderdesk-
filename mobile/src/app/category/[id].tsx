import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CartBar } from '@/components/shop/CartBar';
import { categoryLook } from '@/components/shop/categoryLook';
import { ProductTile } from '@/components/shop/ProductTile';
import { Empty, ErrorView, Loading, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useCartActions } from '@/lib/cartActions';
import { useCart, useWorkspace, type Workspace } from '@/lib/data';
import { mediaUrl } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { CatalogCard, CategoryNode, Page } from '@/lib/types';

const RAIL = 84;

/** A category like in quick-commerce apps: sub-categories down the left, products on the right. */
export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useWorkspace();
  if (ws.loading) return <Loading />;
  if (!ws.current) return <ErrorView message="Choose a distributor first." />;
  return <CategoryView id={id} ws={ws.current} />;
}

type Found = { top: CategoryNode; sub: CategoryNode | null };

function find(tree: CategoryNode[], id: string): Found | null {
  for (const top of tree) {
    if (top.id === id) return { top, sub: null };
    const sub = top.children.find((c) => c.id === id);
    if (sub) return { top, sub };
  }
  return null;
}

function CategoryView({ id, ws }: { id: string; ws: Workspace }) {
  const router = useRouter();
  const base = `/t/${ws.tenantId}`;
  const cart = useCart(ws);
  const actions = useCartActions(ws);
  const tree = useQuery({ queryKey: ['categories', ws.tenantId], queryFn: () => api<CategoryNode[]>(`${base}/catalog/categories`) });
  const found = useMemo(() => (tree.data ? find(tree.data, id) : null), [tree.data, id]);
  const [picked, setPicked] = useState<string | null | undefined>(undefined); // undefined = not chosen yet
  const subId = picked === undefined ? (found?.sub?.id ?? null) : picked;
  const categoryId = subId ?? found?.top.id;

  const products = useQuery({
    queryKey: ['products', ws.tenantId, categoryId, ''],
    queryFn: () => api<Page<CatalogCard>>(`${base}/catalog/products`, { query: { category_id: categoryId, limit: 100 } }),
    enabled: !!categoryId,
  });
  const lines = useMemo(() => new Map((cart.data?.items ?? []).map((l) => [l.unit_id, l])), [cart.data]);

  if (tree.isLoading) return <Loading />;
  if (tree.isError) return <ErrorView message={errorText(tree.error)} onRetry={() => tree.refetch()} />;
  if (!found) return <Empty icon="folder-open-outline" title="Category not found" text="It may have been removed." />;

  const { top } = found;
  const rail = top.children;
  const topIndex = tree.data!.findIndex((c) => c.id === top.id);

  return (
    <View style={{ flex: 1, backgroundColor: colors.card }}>
      <Stack.Screen options={{ title: top.name }} />
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {rail.length > 0 && (
          <ScrollView style={styles.rail} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            <RailItem name={`All ${top.name}`} look={categoryLook(top.name, topIndex)} active={subId === null} onPress={() => setPicked(null)} />
            {rail.map((c, i) => (
              <RailItem key={c.id} name={c.name} image={c.image_url} look={categoryLook(c.name, i)} active={subId === c.id} onPress={() => setPicked(c.id)} />
            ))}
          </ScrollView>
        )}
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {products.isError ? (
            <ErrorView message={errorText(products.error)} onRetry={() => products.refetch()} />
          ) : (
            <FlatList
              data={products.data?.items ?? []}
              keyExtractor={(p) => p.id}
              numColumns={2}
              columnWrapperStyle={{ gap: 8, paddingHorizontal: 8 }}
              contentContainerStyle={{ gap: 10, paddingTop: 10, paddingBottom: 110, flexGrow: 1 }}
              refreshControl={<RefreshControl refreshing={products.isRefetching} onRefresh={() => void products.refetch()} />}
              ListHeaderComponent={
                products.data ? (
                  <Text style={styles.count}>
                    {products.data.total} item{products.data.total === 1 ? '' : 's'}
                  </Text>
                ) : undefined
              }
              ListEmptyComponent={
                products.isLoading ? (
                  <SkeletonList variant="grid" count={4} />
                ) : (
                  <Empty icon="cube-outline" title="Nothing here yet" text="Try another sub-category." />
                )
              }
              renderItem={({ item }) => (
                <ProductTile
                  p={item}
                  line={lines.get(item.default_unit.id)}
                  busy={actions.busy === item.id}
                  locked={ws.mode === 'agent' && !ws.agentShop}
                  onOpen={() => router.push(`/product/${item.id}`)}
                  onAdd={() => actions.add(item.id, item.default_unit)}
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
    </View>
  );
}

function RailItem({
  name,
  image,
  look,
  active,
  onPress,
}: {
  name: string;
  image?: string | null;
  look: ReturnType<typeof categoryLook>;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.railItem, active && styles.railItemOn]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      {active && <View style={styles.railBar} />}
      <View style={[styles.railIcon, { backgroundColor: look.bg }, active && { transform: [{ scale: 1.06 }] }]}>
        {image ? (
          <Image source={{ uri: mediaUrl(image) }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Ionicons name={look.icon} size={22} color={look.fg} />
        )}
      </View>
      <Text style={[styles.railName, active && styles.railNameOn]} numberOfLines={2}>
        {name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { width: RAIL, flexGrow: 0, backgroundColor: colors.card, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  railItem: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  railItemOn: { backgroundColor: colors.primarySoft },
  railBar: { position: 'absolute', right: 0, top: 8, bottom: 8, width: 3, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, backgroundColor: colors.primary },
  railIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  railName: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 4, lineHeight: 14 },
  railNameOn: { color: colors.text, fontWeight: '800' },
  count: { fontSize: 12, color: colors.muted, paddingHorizontal: 10, paddingBottom: 2 },
});
