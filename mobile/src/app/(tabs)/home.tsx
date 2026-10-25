import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductStrip } from '@/components/ProductStrip';
import { BannerCarousel } from '@/components/shop/BannerCarousel';
import { CartBar } from '@/components/shop/CartBar';
import { categoryLook } from '@/components/shop/categoryLook';
import { ProductTile } from '@/components/shop/ProductTile';
import { Button, Empty, ErrorView, Loading, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useCartActions } from '@/lib/cartActions';
import { isHex, shade } from '@/lib/color';
import { useCart, useWorkspace, type Workspace } from '@/lib/data';
import { gridColumns, mediaUrl, saving } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';
import type { Banner, CatalogCard, CategoryNode, Page } from '@/lib/types';

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
  const canSwitch = ws.shopOptions.length + ws.agentOptions.length + ws.manageOptions.length > 1;
  return <Storefront ws={current} shopName={ws.me.data?.shop?.shop_name} canSwitch={canSwitch} />;
}

function Storefront({ ws, shopName, canSwitch }: { ws: Workspace; shopName?: string; canSwitch: boolean }) {
  const router = useRouter();
  const brand = isHex(ws.brandColor) ? ws.brandColor : colors.primary;
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // White status bar text over the coloured header while this screen is in front.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

  const forShop = ws.mode === 'agent' ? ws.agentShop?.name : shopName;
  const needsShop = ws.mode === 'agent' && !ws.agentShop;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={[shade(brand, -0.25), brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <Pressable onPress={() => router.push('/choose')} disabled={!canSwitch} style={styles.headerMain} accessibilityLabel="Switch distributor">
              <View style={styles.logo}>
                {ws.logoUrl ? (
                  <Image source={{ uri: mediaUrl(ws.logoUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Text style={[styles.logoText, { color: brand }]}>{ws.name.slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.row}>
                  <Text style={styles.headerName} numberOfLines={1}>
                    {ws.name}
                  </Text>
                  {canSwitch && <Ionicons name="chevron-down" size={16} color="#FFFFFF" style={{ marginLeft: 3 }} />}
                </View>
                {forShop ? (
                  <View style={styles.row}>
                    <Ionicons name="location-sharp" size={12} color="rgba(255,255,255,0.85)" />
                    <Text style={styles.headerSub} numberOfLines={1}>
                      {ws.mode === 'agent' ? ' Ordering for ' : ' Delivering to '}
                      <Text style={{ fontWeight: '800', color: '#FFFFFF' }}>{forShop}</Text>
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
            {ws.mode === 'agent' && (
              <Pressable onPress={() => router.push('/agent/shops')} hitSlop={8} style={styles.headerIcon} accessibilityLabel="Change shop">
                <Ionicons name="storefront" size={18} color="#FFFFFF" />
              </Pressable>
            )}
          </View>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder='Search "sugar", "cheeni", "चीनी"'
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
        </SafeAreaView>
      </LinearGradient>

      {needsShop ? (
        <Empty
          icon="people-outline"
          title="Choose a shop"
          text="Pick the shop you are ordering for."
          action={<Button title="Choose shop" onPress={() => router.push('/agent/shops')} />}
        />
      ) : (
        <Feed ws={ws} q={q} />
      )}
      <CartBar ws={ws} />
    </View>
  );
}

function Feed({ ws, q }: { ws: Workspace; q: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cart = useCart(ws);
  const actions = useCartActions(ws);
  const base = `/t/${ws.tenantId}`;
  const categories = useQuery({ queryKey: ['categories', ws.tenantId], queryFn: () => api<CategoryNode[]>(`${base}/catalog/categories`) });
  const banners = useQuery({ queryKey: ['banners', ws.tenantId], queryFn: () => api<Banner[]>(`${base}/catalog/banners`) });
  const products = useQuery({
    queryKey: ['products', ws.tenantId, null, q],
    queryFn: () => api<Page<CatalogCard>>(`${base}/catalog/products`, { query: { q, limit: 100 } }),
  });
  const lines = useMemo(() => new Map((cart.data?.items ?? []).map((l) => [l.unit_id, l])), [cart.data]);
  const deals = useMemo(
    () =>
      (products.data?.items ?? [])
        .filter((p) => p.in_stock)
        .map((p) => ({ p, off: saving(p.mrp, p.default_unit.price, p.default_unit.pieces_per_unit)?.percent ?? 0 }))
        .filter((d) => d.off >= 5)
        .sort((a, b) => b.off - a.off)
        .slice(0, 10)
        .map((d) => d.p),
    [products.data],
  );
  // 4 per row; up to 5 categories fit in one row so none is left alone on a second line.
  const catCount = categories.data?.length ?? 0;
  const perRow = catCount === 5 ? 5 : 4;
  const cols = gridColumns(Math.min(width, 1080) - space.lg * 2);
  const tileW = (Math.min(width, 700) - space.lg * 2 - 10 * (perRow - 1)) / perRow;

  const refresh = () => {
    void products.refetch();
    void categories.refetch();
    void banners.refetch();
    void cart.refetch();
  };

  const header = q ? (
    <SectionHead title={`Results for “${q}”`} right={products.data ? `${products.data.total} items` : undefined} />
  ) : (
    <View>
      <View style={{ marginTop: space.lg }}>
        <BannerCarousel
          banners={banners.data ?? []}
          onOpen={(b) => b.link_category_id && router.push(`/category/${b.link_category_id}`)}
        />
      </View>

      {(categories.data ?? []).length > 0 && (
        <View style={styles.section}>
          <SectionHead title="Shop by category" />
          <View style={styles.catGrid}>
            {(categories.data ?? []).map((c, i) => {
              const look = categoryLook(c.name, i);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(`/category/${c.id}`)}
                  style={({ pressed }) => [{ width: tileW }, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button">
                  <View style={[styles.catIcon, { backgroundColor: look.bg, height: tileW }]}>
                    {c.image_url ? (
                      <Image source={{ uri: mediaUrl(c.image_url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <Ionicons name={look.icon} size={Math.min(tileW * 0.42, 34)} color={look.fg} />
                    )}
                  </View>
                  <Text style={styles.catName} numberOfLines={2}>
                    {c.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <View style={styles.stripWrap}>
        <ProductStrip title="Buy again" ws={ws} path="/cart/suggestions" />
      </View>
      {deals.length > 0 && (
        <View style={styles.stripWrap}>
          <ProductStrip title="Top deals" ws={ws} items={deals} />
        </View>
      )}
      <View style={styles.section}>
        <SectionHead title="All products" right={products.data ? `${products.data.total} items` : undefined} />
      </View>
    </View>
  );

  if (products.isError) return <ErrorView message={errorText(products.error)} onRetry={() => products.refetch()} />;
  return (
    <FlatList
      data={products.data?.items ?? []}
      keyExtractor={(p) => p.id}
      key={`grid-${cols}`}
      numColumns={cols}
      columnWrapperStyle={{ gap: 10, paddingHorizontal: space.lg }}
      contentContainerStyle={{ gap: 12, paddingBottom: 110, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={products.isRefetching} onRefresh={refresh} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        products.isLoading ? (
          <SkeletonList variant="grid" count={4} />
        ) : (
          <Empty icon="search-outline" title="Nothing found" text={q ? `No products match “${q}”. Try another spelling.` : 'No products here yet.'} />
        )
      }
      renderItem={({ item }) => (
        <ProductTile
          columns={cols}
          p={item}
          line={lines.get(item.default_unit.id)}
          busy={actions.busy === item.id}
          onOpen={() => router.push(`/product/${item.id}`)}
          onAdd={() => actions.add(item.id, item.default_unit, undefined, item.name)}
          onQty={(qty) => {
            const line = lines.get(item.default_unit.id);
            if (line) actions.setQty(item.id, line, qty);
          }}
        />
      )}
    />
  );
}

function SectionHead({ title, right }: { title: string; right?: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {title}
      </Text>
      {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoText: { fontSize: 22, fontWeight: '900' },
  headerName: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', flexShrink: 1 },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', flexShrink: 1 },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.md,
    marginBottom: space.lg,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15, color: colors.text },
  section: { marginTop: space.xl },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    marginBottom: space.md,
    marginTop: space.sm,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text, flex: 1 },
  sectionRight: { fontSize: 13, color: colors.muted },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: space.md, paddingHorizontal: space.lg },
  catIcon: { borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  catName: { fontSize: 12, fontWeight: '600', color: colors.text, textAlign: 'center', marginTop: 6, lineHeight: 15 },
  stripWrap: { paddingLeft: space.lg, marginTop: space.sm },
});
