import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductStrip } from '@/components/ProductStrip';
import { CartBar } from '@/components/shop/CartBar';
import { categoryLook } from '@/components/shop/categoryLook';
import { ProductTile } from '@/components/shop/ProductTile';
import { Button, Empty, ErrorView, Loading, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useCartActions } from '@/lib/cartActions';
import { useCart, useWorkspace, type Workspace } from '@/lib/data';
import { mediaUrl } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';
import type { CatalogCard, CategoryNode, Page } from '@/lib/types';

export default function Home() {
  const ws = useWorkspace();
  const router = useRouter();

  if (ws.loading) return <Loading />;
  if (ws.me.isError) return <ErrorView message={errorText(ws.me.error)} onRetry={() => ws.me.refetch()} />;

  const current = ws.current;
  if (!current) {
    const pending = (ws.distributors.data ?? []).filter((d) => d.status === 'pending');
    return (
      <SafeAreaView style={{ flex: 1 }}>
        {pending.length ? (
          <Empty
            icon="hourglass-outline"
            title="Waiting for approval"
            text={`${pending.map((d) => d.name).join(', ')} will approve your shop soon. You can order once they do.`}
            action={<Button title="Add another distributor" variant="secondary" onPress={() => router.push('/add-distributor')} />}
          />
        ) : (
          <Empty
            icon="business-outline"
            title="Add your first distributor"
            text="Ask your distributor or their salesman for their join code, or scan the QR on their card."
            action={<Button title="Add distributor" onPress={() => router.push('/add-distributor')} />}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.card }} edges={['top']}>
      <Header ws={current} shopName={ws.me.data?.shop?.shop_name} canSwitch={ws.shopOptions.length + ws.agentOptions.length + ws.manageOptions.length > 1} />
      {current.mode === 'agent' && !current.agentShop ? (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <Empty
            icon="people-outline"
            title="Choose a shop"
            text="Pick the shop you are ordering for."
            action={<Button title="Choose shop" onPress={() => router.push('/agent/shops')} />}
          />
        </View>
      ) : (
        <Catalog ws={current} />
      )}
    </SafeAreaView>
  );
}

function Header({ ws, shopName, canSwitch }: { ws: Workspace; shopName?: string; canSwitch: boolean }) {
  const router = useRouter();
  const forShop = ws.mode === 'agent' ? ws.agentShop?.name : shopName;
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.push('/choose')} disabled={!canSwitch} style={styles.headerMain}>
        <View style={[styles.logo, ws.brandColor ? { backgroundColor: ws.brandColor } : null]}>
          {ws.logoUrl ? (
            <Image source={{ uri: mediaUrl(ws.logoUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Text style={styles.logoText}>{ws.name.slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.row}>
            <Text style={styles.headerName} numberOfLines={1}>
              {ws.name}
            </Text>
            {canSwitch && <Ionicons name="chevron-down" size={16} color={colors.text} style={{ marginLeft: 2 }} />}
          </View>
          {forShop ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {ws.mode === 'agent' ? 'Ordering for ' : 'Delivering to '}
              <Text style={{ fontWeight: '700', color: colors.text }}>{forShop}</Text>
            </Text>
          ) : null}
        </View>
      </Pressable>
      {ws.mode === 'agent' && (
        <Pressable onPress={() => router.push('/agent/shops')} hitSlop={8} style={styles.headerIcon} accessibilityLabel="Change shop">
          <Ionicons name="storefront-outline" size={20} color={colors.primaryDark} />
        </Pressable>
      )}
    </View>
  );
}

function Catalog({ ws }: { ws: Workspace }) {
  const router = useRouter();
  const cart = useCart(ws);
  const actions = useCartActions(ws);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [topId, setTopId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const categories = useQuery({
    queryKey: ['categories', ws.tenantId],
    queryFn: () => api<CategoryNode[]>(`/t/${ws.tenantId}/catalog/categories`),
  });
  const categoryId = subId ?? topId;
  const products = useQuery({
    queryKey: ['products', ws.tenantId, categoryId, q],
    queryFn: () =>
      api<Page<CatalogCard>>(`/t/${ws.tenantId}/catalog/products`, {
        query: { category_id: categoryId, q, limit: 100 },
      }),
  });

  const top = useMemo(() => categories.data?.find((c) => c.id === topId), [categories.data, topId]);
  const lines = useMemo(() => new Map((cart.data?.items ?? []).map((l) => [l.unit_id, l])), [cart.data]);
  const browsing = !q && !topId;
  const heading = q ? `Results for “${q}”` : subId ? top?.children.find((c) => c.id === subId)?.name : top ? top.name : 'All products';

  const listHeader = (
    <View>
      {!q && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats} style={styles.catsScroll}>
          <CategoryTile name="All" icon="grid-outline" bg={colors.primarySoft} fg={colors.primary} active={!topId} onPress={() => {
            setTopId(null);
            setSubId(null);
          }} />
          {(categories.data ?? []).map((c, i) => {
            const look = categoryLook(c.name, i);
            return (
              <CategoryTile
                key={c.id}
                name={c.name}
                icon={look.icon}
                bg={look.bg}
                fg={look.fg}
                active={topId === c.id}
                onPress={() => {
                  setTopId(c.id);
                  setSubId(null);
                }}
              />
            );
          })}
        </ScrollView>
      )}
      {!q && top && top.children.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subs} style={{ flexGrow: 0 }}>
          <Chip label="All" active={!subId} onPress={() => setSubId(null)} />
          {top.children.map((c) => (
            <Chip key={c.id} label={c.name} active={subId === c.id} onPress={() => setSubId(c.id)} />
          ))}
        </ScrollView>
      )}
      {browsing && (
        <View style={styles.strip}>
          <ProductStrip title="Buy again" ws={ws} path="/cart/suggestions" />
        </View>
      )}
      <View style={styles.headingRow}>
        <Text style={styles.heading} numberOfLines={1}>
          {heading}
        </Text>
        {products.data ? <Text style={styles.count}>{products.data.total} items</Text> : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search sugar, cheeni, चीनी…"
            placeholderTextColor={colors.faint}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.faint} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {products.isError ? (
        <ErrorView message={errorText(products.error)} onRetry={() => products.refetch()} />
      ) : (
        <FlatList
          data={products.data?.items ?? []}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: space.md, paddingHorizontal: space.lg }}
          contentContainerStyle={{ gap: space.md, paddingBottom: 96, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={products.isRefetching}
              onRefresh={() => {
                void products.refetch();
                void categories.refetch();
                void cart.refetch();
              }}
            />
          }
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            products.isLoading ? (
              <SkeletonList variant="grid" count={4} />
            ) : (
              <Empty icon="search-outline" title="Nothing found" text={q ? `No products match “${q}”. Try another spelling.` : 'No products here yet.'} />
            )
          }
          renderItem={({ item }) => (
            <ProductTile
              p={item}
              line={lines.get(item.default_unit.id)}
              busy={actions.busy === item.id}
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
      <CartBar ws={ws} />
    </View>
  );
}

function CategoryTile({
  name,
  icon,
  bg,
  fg,
  active,
  onPress,
}: {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  bg: string;
  fg: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.catTile} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <View style={[styles.catIcon, { backgroundColor: bg }, active && { borderColor: fg }]}>
        <Ionicons name={icon} size={26} color={fg} />
      </View>
      <Text style={[styles.catName, active && { color: colors.text, fontWeight: '800' }]} numberOfLines={2}>
        {name}
      </Text>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.sm,
    backgroundColor: colors.card,
  },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoText: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  headerName: { fontSize: 18, fontWeight: '800', color: colors.text, flexShrink: 1 },
  headerSub: { fontSize: 13, color: colors.muted, marginTop: 1 },
  headerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  searchWrap: {
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, minHeight: 44, fontSize: 16, color: colors.text },
  catsScroll: { flexGrow: 0, backgroundColor: colors.card },
  cats: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.md, gap: 4 },
  catTile: { width: 76, alignItems: 'center' },
  catIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  catName: { fontSize: 12, fontWeight: '600', color: colors.muted, marginTop: 6, textAlign: 'center' },
  subs: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#FFFFFF' },
  strip: { paddingLeft: space.lg },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    marginTop: space.lg,
    marginBottom: 2,
  },
  heading: { fontSize: 18, fontWeight: '800', color: colors.text, flex: 1 },
  count: { fontSize: 13, color: colors.muted },
});
