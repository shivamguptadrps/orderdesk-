import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Empty, ErrorView, Loading } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useWorkspace, type Workspace } from '@/lib/data';
import { inr, mediaUrl, packLabel } from '@/lib/format';
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
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Header ws={current} canSwitch={ws.shopOptions.length + ws.agentOptions.length + ws.manageOptions.length > 1} />
      {current.mode === 'agent' && !current.agentShop ? (
        <Empty
          icon="people-outline"
          title="Choose a shop"
          text="Pick the shop you are ordering for."
          action={<Button title="Choose shop" onPress={() => router.push('/agent/shops')} />}
        />
      ) : (
        <Catalog ws={current} />
      )}
    </SafeAreaView>
  );
}

function Header({ ws, canSwitch }: { ws: Workspace; canSwitch: boolean }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      {ws.logoUrl ? <Image source={{ uri: mediaUrl(ws.logoUrl) }} style={styles.logo} contentFit="cover" /> : null}
      <Pressable onPress={() => router.push('/choose')} disabled={!canSwitch} style={{ flex: 1 }}>
        <Text style={styles.headerLabel}>{ws.mode === 'agent' ? 'Agent for' : 'Ordering from'}</Text>
        <View style={styles.row}>
          <Text style={[styles.headerName, ws.brandColor ? { color: ws.brandColor } : null]} numberOfLines={1}>
            {ws.name}
          </Text>
          {canSwitch && <Ionicons name="chevron-down" size={18} color={colors.muted} style={{ marginLeft: 4 }} />}
        </View>
      </Pressable>
      {ws.mode === 'agent' && ws.agentShop && (
        <Pressable onPress={() => router.push('/agent/shops')} style={styles.shopPill}>
          <Ionicons name="storefront-outline" size={14} color={colors.primaryDark} />
          <Text style={styles.shopPillText} numberOfLines={1}>
            {ws.agentShop.name}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function Catalog({ ws }: { ws: Workspace }) {
  const router = useRouter();
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

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search: sugar, cheeni, चीनी…"
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flexGrow: 0 }}>
        <Chip label="All" active={!topId} onPress={() => {
            setTopId(null);
            setSubId(null);
          }} />
        {(categories.data ?? []).map((c) => (
          <Chip key={c.id} label={c.name} active={topId === c.id} onPress={() => {
              setTopId(c.id);
              setSubId(null);
            }} />
        ))}
      </ScrollView>
      {top && top.children.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flexGrow: 0 }}>
          <Chip small label={`All ${top.name}`} active={!subId} onPress={() => setSubId(null)} />
          {top.children.map((c) => (
            <Chip small key={c.id} label={c.name} active={subId === c.id} onPress={() => setSubId(c.id)} />
          ))}
        </ScrollView>
      )}

      {products.isLoading ? (
        <Loading />
      ) : products.isError ? (
        <ErrorView message={errorText(products.error)} onRetry={() => products.refetch()} />
      ) : (
        <FlatList
          data={products.data?.items ?? []}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: space.md }}
          contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={products.isRefetching} onRefresh={() => {
            void products.refetch();
            void categories.refetch();
          }} />
          }
          ListEmptyComponent={
            <Empty icon="search-outline" title="Nothing found" text={q ? `No products match "${q}".` : 'No products here yet.'} />
          }
          renderItem={({ item }) => <ProductCard p={item} onPress={() => router.push(`/product/${item.id}`)} />}
        />
      )}
    </View>
  );
}

function Chip({ label, active, onPress, small }: { label: string; active: boolean; onPress: () => void; small?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, small && styles.chipSmall, active && styles.chipActive]}>
      <Text style={[styles.chipText, small && { fontSize: 13 }, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ProductCard({ p, onPress }: { p: CatalogCard; onPress: () => void }) {
  const u = p.default_unit;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.imageBox}>
        {p.image ? (
          <Image source={{ uri: mediaUrl(p.image) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : (
          <Ionicons name="cube-outline" size={36} color={colors.faint} />
        )}
        {!p.in_stock && (
          <View style={styles.outBadge}>
            <Text style={styles.outText}>Out of stock</Text>
          </View>
        )}
      </View>
      <View style={{ padding: space.sm }}>
        <Text style={styles.name} numberOfLines={2}>
          {p.name}
        </Text>
        <Text style={styles.price}>
          {inr(u.price)} <Text style={styles.per}>/ {packLabel(u.name, u.pieces_per_unit)}</Text>
        </Text>
        {u.pieces_per_unit > 1 && <Text style={styles.per}>{inr(u.price_per_piece)} per piece</Text>}
      </View>
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
    paddingBottom: space.sm,
    gap: space.sm,
  },
  logo: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.card },
  headerLabel: { fontSize: 12, color: colors.muted },
  headerName: { fontSize: 20, fontWeight: '800', color: colors.text, flexShrink: 1 },
  shopPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 170,
  },
  shopPillText: { color: colors.primaryDark, fontWeight: '600', fontSize: 13 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, minHeight: 44, fontSize: 16, color: colors.text },
  chips: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSmall: { paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#FFFFFF' },
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: '50%',
  },
  imageBox: { aspectRatio: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  outBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    backgroundColor: colors.errorSoft,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  outText: { color: colors.error, fontSize: 11, fontWeight: '700' },
  name: { fontSize: 14, fontWeight: '600', color: colors.text, minHeight: 38 },
  price: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 4 },
  per: { fontSize: 12, fontWeight: '400', color: colors.muted },
});
