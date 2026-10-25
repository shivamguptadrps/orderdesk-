import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductStrip } from '@/components/ProductStrip';
import { AddControl } from '@/components/shop/ProductTile';
import { Banner, ErrorView, Loading, Skeleton } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useCartActions } from '@/lib/cartActions';
import { useCart, useWorkspace, type Workspace } from '@/lib/data';
import { inr, mediaUrl, packName, saving } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';
import type { CatalogDetail, Unit } from '@/lib/types';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useWorkspace();
  if (ws.loading) return <Loading />;
  if (!ws.current) return <ErrorView message="Choose a distributor first." />;
  return <Product id={id} ws={ws.current} />;
}

function Product({ id, ws }: { id: string; ws: Workspace }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const product = useQuery({
    queryKey: ['product', ws.tenantId, id],
    queryFn: () => api<CatalogDetail>(`/t/${ws.tenantId}/catalog/products/${id}`),
  });
  const cart = useCart(ws);
  const actions = useCartActions(ws);
  const [unitId, setUnitId] = useState<string | null>(null);

  const bestValue = useMemo(() => {
    const units = product.data?.units ?? [];
    if (units.length < 2) return null;
    return units.reduce((a, b) => (b.price_per_piece < a.price_per_piece ? b : a)).id;
  }, [product.data]);

  if (product.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.card }}>
        <Skeleton height={width * 0.85} style={{ borderRadius: 0 }} />
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton height={14} width="40%" />
          <Skeleton height={24} width="85%" />
          <Skeleton height={28} width="35%" />
        </View>
      </View>
    );
  }
  if (product.isError) return <ErrorView message={errorText(product.error)} onRetry={() => product.refetch()} />;
  const p = product.data!;
  const unit = p.units.find((u) => u.id === unitId) ?? p.units.find((u) => u.is_default) ?? p.units[0];
  const off = saving(p.mrp, unit.price, unit.pieces_per_unit);
  const line = cart.data?.items.find((l) => l.unit_id === unit.id);
  const needsShop = ws.mode === 'agent' && !ws.agentShop;
  const inCartCount = cart.data?.items.filter((l) => l.product_id === p.id).length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: p.brand ?? '' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <Gallery images={p.images} width={width} />

        <View style={styles.infoCard}>
          {p.brand ? <Text style={styles.brand}>{p.brand.toUpperCase()}</Text> : null}
          <Text style={styles.name}>{p.name}</Text>
          <Text style={styles.path}>{p.category_path.join(' › ')}</Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>{inr(unit.price)}</Text>
            {off ? (
              <>
                <Text style={styles.mrp}>MRP {inr(off.mrp)}</Text>
                <View style={styles.offPill}>
                  <Text style={styles.offText}>{off.percent}% OFF</Text>
                </View>
              </>
            ) : null}
          </View>
          <Text style={styles.priceSub}>
            for {packName(unit.name, unit.pieces_per_unit)}
            {unit.pieces_per_unit > 1 ? ` · ${inr(unit.price_per_piece)} per piece` : ''}
          </Text>
          {!p.in_stock && (
            <View style={{ marginTop: space.md }}>
              <Banner kind="error" text="Out of stock right now. Check again later." />
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Choose pack size</Text>
          {p.units.map((u) => (
            <PackOption key={u.id} u={u} mrp={p.mrp} active={u.id === unit.id} best={u.id === bestValue} onPress={() => setUnitId(u.id)} />
          ))}
        </View>

        {p.features.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Product details</Text>
            {p.features.map((f, i) => (
              <View key={f.key} style={[styles.featureRow, i > 0 && styles.featureBorder]}>
                <Text style={styles.featureLabel}>{f.label}</Text>
                <Text style={styles.featureValue}>
                  {typeof f.value === 'boolean' ? (f.value ? 'Yes' : 'No') : String(f.value)}
                  {f.unit ? ` ${f.unit}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
        {p.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About this product</Text>
            <Text style={styles.description}>{p.description}</Text>
          </View>
        ) : null}
        <View style={{ paddingLeft: space.lg }}>
          <ProductStrip title="Customers also buy" ws={ws} path={`/catalog/products/${p.id}/related`} />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {needsShop && <Banner kind="warn" text="Choose the shop you are ordering for first." />}
        <View style={styles.footerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.footerPrice}>{inr(line ? unit.price * line.qty : unit.price)}</Text>
            <Text style={styles.footerSub} numberOfLines={1}>
              {line ? `${line.qty} × ${packName(unit.name, unit.pieces_per_unit)} in cart` : packName(unit.name, unit.pieces_per_unit)}
            </Text>
          </View>
          {p.in_stock && unit.in_stock ? (
            <View style={{ minWidth: 150 }}>
              <AddControl
                size="lg"
                unit={unit}
                line={line}
                busy={actions.busy === unit.id}
                disabled={needsShop}
                onAdd={() => actions.add(unit.id, unit)}
                onQty={(qty) => line && actions.setQty(unit.id, line, qty)}
              />
            </View>
          ) : (
            <Text style={styles.unavailable}>Not available</Text>
          )}
        </View>
        {inCartCount > 0 && (
          <Pressable onPress={() => router.navigate('/cart')} style={styles.goCart}>
            <Ionicons name="cart" size={16} color={colors.primary} />
            <Text style={styles.goCartText}>Go to cart</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function PackOption({ u, mrp, active, best, onPress }: { u: Unit; mrp: number | null; active: boolean; best: boolean; onPress: () => void }) {
  const off = saving(mrp, u.price, u.pieces_per_unit);
  const rules = [u.min_qty > 1 ? `min ${u.min_qty}` : null, u.step_qty > 1 ? `in multiples of ${u.step_qty}` : null].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} style={[styles.pack, active && styles.packActive]} accessibilityRole="radio" accessibilityState={{ checked: active }}>
      <View style={[styles.radio, active && styles.radioOn]}>{active && <View style={styles.radioDot} />}</View>
      <View style={{ flex: 1 }}>
        <View style={styles.row}>
          <Text style={styles.packName}>{packName(u.name, u.pieces_per_unit)}</Text>
          {best && (
            <View style={styles.bestPill}>
              <Text style={styles.bestText}>Best value</Text>
            </View>
          )}
        </View>
        <Text style={styles.packMeta}>
          {u.pieces_per_unit > 1 ? `${inr(u.price_per_piece)} per piece` : 'Single piece'}
          {rules ? ` · ${rules}` : ''}
        </Text>
        {!u.in_stock && <Text style={styles.packOut}>Not enough stock</Text>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.packPrice}>{inr(u.price)}</Text>
        {off ? <Text style={styles.packOff}>{off.percent}% off</Text> : null}
      </View>
    </Pressable>
  );
}

function Gallery({ images, width }: { images: string[]; width: number }) {
  const [index, setIndex] = useState(0);
  const height = Math.min(width * 0.85, 420);
  if (!images.length) {
    return (
      <View style={[styles.galleryEmpty, { width, height }]}>
        <Ionicons name="cube-outline" size={64} color={colors.faint} />
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: colors.card }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>
        {images.map((url) => (
          <Image key={url} source={{ uri: mediaUrl(url) }} style={{ width, height }} contentFit="contain" transition={150} />
        ))}
      </ScrollView>
      {images.length > 1 && (
        <View style={styles.dots}>
          {images.map((url, i) => (
            <View key={url} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  galleryEmpty: { backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: space.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { width: 18, backgroundColor: colors.primary },
  infoCard: {
    backgroundColor: colors.card,
    padding: space.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  brand: { fontSize: 12, fontWeight: '800', color: colors.primary, letterSpacing: 0.8 },
  name: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 4, lineHeight: 28 },
  path: { fontSize: 12, color: colors.muted, marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },
  price: { fontSize: 26, fontWeight: '800', color: colors.text },
  mrp: { fontSize: 14, color: colors.faint, textDecorationLine: 'line-through' },
  offPill: { backgroundColor: colors.okSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  offText: { color: colors.ok, fontSize: 12, fontWeight: '800' },
  priceSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  section: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, marginTop: space.md, marginHorizontal: space.md },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: space.md },
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginBottom: space.sm,
  },
  packActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  packName: { fontSize: 15, fontWeight: '700', color: colors.text },
  bestPill: { backgroundColor: '#FFF4E0', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  bestText: { fontSize: 11, fontWeight: '800', color: '#B76E00' },
  packMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  packOut: { fontSize: 12, color: colors.error, fontWeight: '600', marginTop: 2 },
  packPrice: { fontSize: 16, fontWeight: '800', color: colors.text },
  packOff: { fontSize: 12, color: colors.ok, fontWeight: '700', marginTop: 2 },
  featureRow: { flexDirection: 'row', paddingVertical: 10 },
  featureBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  featureLabel: { flex: 1, color: colors.muted, fontSize: 14 },
  featureValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  description: { fontSize: 15, color: colors.text, lineHeight: 22 },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  footerPrice: { fontSize: 20, fontWeight: '800', color: colors.text },
  footerSub: { fontSize: 12, color: colors.muted },
  unavailable: { fontSize: 15, fontWeight: '700', color: colors.faint },
  goCart: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: space.sm },
  goCartText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});
