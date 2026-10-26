import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, useWindowDimensions, View } from 'react-native';

import { CartBar } from '@/components/shop/CartBar';
import { ProductTile } from '@/components/shop/ProductTile';
import { SizeSheet } from '@/components/shop/SizeSheet';
import { Empty, ErrorView, Loading, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useCartActions } from '@/lib/cartActions';
import { useCart, useWorkspace, type Workspace } from '@/lib/data';
import { gridColumns } from '@/lib/format';
import { space } from '@/lib/theme';
import type { CatalogCard, Page } from '@/lib/types';

/** All products of one brand ("Shop by brand"). */
export default function BrandScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const ws = useWorkspace();
  if (ws.loading) return <Loading />;
  if (!ws.current) return <ErrorView message="Choose a distributor first." />;
  return <BrandView id={id} name={name} ws={ws.current} />;
}

function BrandView({ id, name, ws }: { id: string; name?: string; ws: Workspace }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cart = useCart(ws);
  const actions = useCartActions(ws);
  const [sizesOf, setSizesOf] = useState<CatalogCard | null>(null);
  const products = useQuery({
    queryKey: ['products', ws.tenantId, 'brand', id],
    queryFn: () => api<Page<CatalogCard>>(`/t/${ws.tenantId}/catalog/products`, { query: { brand_id: id, limit: 100, group_variants: true } }),
  });
  const lines = useMemo(() => new Map((cart.data?.items ?? []).map((l) => [l.unit_id, l])), [cart.data]);
  const cols = gridColumns(Math.min(width, 1080) - space.lg * 2);

  if (products.isError) return <ErrorView message={errorText(products.error)} onRetry={() => products.refetch()} />;
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: name ?? 'Brand' }} />
      <FlatList
        data={products.data?.items ?? []}
        keyExtractor={(p) => p.id}
        key={`grid-${cols}`}
        numColumns={cols}
        columnWrapperStyle={{ gap: 10, paddingHorizontal: space.lg }}
        contentContainerStyle={{ gap: 12, paddingTop: space.lg, paddingBottom: 110, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={products.isRefetching} onRefresh={() => void products.refetch()} />}
        ListEmptyComponent={products.isLoading ? <SkeletonList variant="grid" count={4} /> : <Empty icon="pricetags-outline" title="Nothing here yet" text="This brand has no products to order right now." />}
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
      <CartBar ws={ws} />
      {sizesOf && <SizeSheet ws={ws} product={sizesOf} onClose={() => setSizesOf(null)} />}
    </View>
  );
}
