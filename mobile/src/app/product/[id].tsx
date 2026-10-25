import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductStrip } from '@/components/ProductStrip';
import { QtyPrompt, qtyError, quickQtys } from '@/components/shop/QtyPrompt';
import { Banner, ErrorView, firstQty, Loading, Skeleton } from '@/components/ui';
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
  const [qtyByUnit, setQtyByUnit] = useState<Record<string, number>>({});
  const [typing, setTyping] = useState(false);

  const bestValue = useMemo(() => {
    const units = product.data?.units ?? [];
    if (units.length < 2) return null;
    return units.reduce((a, b) => (b.price_per_piece < a.price_per_piece ? b : a)).id;
  }, [product.data]);

  if (product.isLoading) {
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
        <Skeleton height={Math.min(width - 32, 420)} style={{ borderRadius: radius.lg }} />
        <Skeleton height={16} width="40%" />
        <Skeleton height={26} width="85%" />
        <Skeleton height={30} width="35%" />
      </View>
    );
  }
  if (product.isError) return <ErrorView message={errorText(product.error)} onRetry={() => product.refetch()} />;
  const p = product.data!;
  const unit = p.units.find((u) => u.id === unitId) ?? p.units.find((u) => u.is_default) ?? p.units[0];
  const line = cart.data?.items.find((l) => l.unit_id === unit.id);
  const qty = qtyByUnit[unit.id] ?? line?.qty ?? firstQty(unit.min_qty, unit.step_qty);
  const setQty = (n: number) => setQtyByUnit((m) => ({ ...m, [unit.id]: n }));
  const off = saving(p.mrp, unit.price, unit.pieces_per_unit);
  const needsShop = ws.mode === 'agent' && !ws.agentShop;
  const sellable = p.in_stock && unit.in_stock;
  const busy = actions.busy === unit.id;
  const step = unit.step_qty;
  const canDown = qty - step >= firstQty(unit.min_qty, step);
  const canUp = unit.max_qty === null || qty + step <= unit.max_qty;
  const inCart = line && line.qty === qty;
  const pieces = qty * unit.pieces_per_unit;

  function submit() {
    if (inCart) return router.navigate('/cart');
    if (qtyError(qty, unit)) return;
    if (line) actions.setQty(unit.id, line, qty);
    else actions.add(unit.id, unit, qty, p.name);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xl }}>
        <Gallery images={p.images} size={Math.min(width - space.md * 2, 520)} off={sellable ? off?.percent : undefined} />

        <View style={styles.card}>
          {p.brand ? (
            <View style={styles.brandPill}>
              <Text style={styles.brandText}>{p.brand}</Text>
            </View>
          ) : null}
          <Text style={styles.name}>{p.name}</Text>
          <Text style={styles.path}>{p.category_path.join(' › ')}</Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>{inr(unit.price)}</Text>
            {off ? <Text style={styles.mrp}>MRP {inr(off.mrp)}</Text> : null}
            {off ? (
              <View style={styles.offPill}>
                <Text style={styles.offText}>{off.percent}% OFF</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.priceSub}>
            per {packName(unit.name, unit.pieces_per_unit)}
            {unit.pieces_per_unit > 1 ? ` · ${inr(unit.price_per_piece)} per piece` : ''}
          </Text>
          <View style={[styles.stock, { backgroundColor: sellable ? colors.okSoft : colors.errorSoft }]}>
            <View style={[styles.stockDot, { backgroundColor: sellable ? colors.ok : colors.error }]} />
            <Text style={[styles.stockText, { color: sellable ? colors.ok : colors.error }]}>
              {sellable ? 'In stock' : p.in_stock ? 'Not enough stock for this pack' : 'Out of stock'}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pack size</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.sm }}>
            {p.units.map((u) => (
              <PackCard key={u.id} u={u} mrp={p.mrp} active={u.id === unit.id} best={u.id === bestValue} onPress={() => setUnitId(u.id)} />
            ))}
          </ScrollView>
        </View>

        {sellable && (
          <View style={styles.card}>
            <View style={styles.qtyHead}>
              <Text style={styles.cardTitle}>Quantity</Text>
              <Text style={styles.rules}>
                {[unit.min_qty > 1 ? `min ${unit.min_qty}` : null, step > 1 ? `in multiples of ${step}` : null, unit.max_qty ? `max ${unit.max_qty}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <View style={styles.qtyRow}>
              <Pressable onPress={() => setQty(qty - step)} disabled={!canDown} style={[styles.qtyBtn, !canDown && styles.qtyBtnOff]} accessibilityLabel="Less">
                <Ionicons name="remove" size={24} color={canDown ? colors.primary : colors.faint} />
              </Pressable>
              <Pressable onPress={() => setTyping(true)} style={styles.qtyValue} accessibilityLabel={`Quantity ${qty}, tap to type`}>
                <Text style={styles.qtyNumber}>{qty}</Text>
                <Text style={styles.qtyUnit}>
                  {packName(unit.name, unit.pieces_per_unit)} · tap to type
                </Text>
              </Pressable>
              <Pressable onPress={() => setQty(qty + step)} disabled={!canUp} style={[styles.qtyBtn, !canUp && styles.qtyBtnOff]} accessibilityLabel="More">
                <Ionicons name="add" size={24} color={canUp ? colors.primary : colors.faint} />
              </Pressable>
            </View>
            <View style={styles.quick}>
              {quickQtys(unit).map((q) => (
                <Pressable key={q} onPress={() => setQty(q)} style={[styles.quickChip, qty === q && styles.quickOn]}>
                  <Text style={[styles.quickText, qty === q && { color: colors.primary }]}>{q}</Text>
                </Pressable>
              ))}
            </View>
            {unit.pieces_per_unit > 1 && (
              <Text style={styles.pieces}>
                {qty} × {unit.pieces_per_unit} = <Text style={{ fontWeight: '800', color: colors.text }}>{pieces} pieces</Text>
              </Text>
            )}
          </View>
        )}

        <View style={styles.perks}>
          <Perk icon="shield-checkmark-outline" text="Distributor confirms every order" />
          <Perk icon="cash-outline" text="No online payment" />
          <Perk icon="cube-outline" text={`${unit.pieces_per_unit} pc${unit.pieces_per_unit > 1 ? 's' : ''} per ${unit.name.replace(/\s*\(\d+\)$/, '').toLowerCase()}`} />
        </View>

        {p.features.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Product details</Text>
            {p.features.map((f, i) => (
              <View key={f.key} style={[styles.featureRow, i % 2 === 0 && styles.featureAlt]}>
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
          <View style={styles.card}>
            <Text style={styles.cardTitle}>About this product</Text>
            <Text style={styles.description}>{p.description}</Text>
          </View>
        ) : null}
        <ProductStrip title="Customers also buy" ws={ws} path={`/catalog/products/${p.id}/related`} />
      </ScrollView>

      <View style={styles.footer}>
        {needsShop && <Banner kind="warn" text="Choose the shop you are ordering for first." />}
        <View style={styles.footerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.footerPrice}>{inr(unit.price * qty)}</Text>
            <Text style={styles.footerSub} numberOfLines={1}>
              {qty} × {packName(unit.name, unit.pieces_per_unit)}
              {inCart ? ' · in your cart' : line ? ` · cart has ${line.qty}` : ''}
            </Text>
          </View>
          {sellable ? (
            <Pressable
              onPress={submit}
              disabled={busy || needsShop}
              style={({ pressed }) => [styles.cta, inCart && styles.ctaGo, (busy || needsShop) && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
              accessibilityRole="button">
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name={inCart ? 'cart' : line ? 'refresh' : 'cart-outline'} size={18} color="#FFFFFF" />
                  <Text style={styles.ctaText}>{inCart ? 'Go to cart' : line ? 'Update cart' : 'Add to cart'}</Text>
                </>
              )}
            </Pressable>
          ) : (
            <Text style={styles.unavailable}>Not available</Text>
          )}
        </View>
      </View>

      <QtyPrompt
        visible={typing}
        title={p.name}
        unitLabel={packName(unit.name, unit.pieces_per_unit)}
        initial={qty}
        rules={unit}
        onClose={() => setTyping(false)}
        onSave={(n) => {
          setTyping(false);
          setQty(n);
        }}
      />
    </SafeAreaView>
  );
}

function PackCard({ u, mrp, active, best, onPress }: { u: Unit; mrp: number | null; active: boolean; best: boolean; onPress: () => void }) {
  const off = saving(mrp, u.price, u.pieces_per_unit);
  return (
    <Pressable onPress={onPress} style={[styles.pack, active && styles.packOn, !u.in_stock && { opacity: 0.55 }]} accessibilityRole="radio" accessibilityState={{ checked: active }}>
      {best && (
        <View style={styles.bestTag}>
          <Text style={styles.bestText}>BEST VALUE</Text>
        </View>
      )}
      <Text style={styles.packName}>{packName(u.name, u.pieces_per_unit)}</Text>
      <Text style={styles.packPrice}>{inr(u.price)}</Text>
      <Text style={styles.packMeta}>{u.pieces_per_unit > 1 ? `${inr(u.price_per_piece)}/pc` : 'per piece'}</Text>
      {off ? <Text style={styles.packOff}>{off.percent}% off</Text> : <Text style={styles.packOff}> </Text>}
      {!u.in_stock && <Text style={styles.packOut}>Low stock</Text>}
      {active && (
        <View style={styles.packCheck}>
          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
        </View>
      )}
    </Pressable>
  );
}

function Perk({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.perk}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.perkText}>{text}</Text>
    </View>
  );
}

function Gallery({ images, size, off }: { images: string[]; size: number; off?: number }) {
  const [index, setIndex] = useState(0);
  const inner = size - 2; // inside the 1px border
  return (
    <View style={[styles.gallery, { width: size, height: size }]}>
      {images.length ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / inner))}>
          {images.map((url) => (
            <View key={url} style={{ width: inner, height: inner, padding: space.lg }}>
              <Image source={{ uri: mediaUrl(url) }} style={{ flex: 1 }} contentFit="contain" transition={150} />
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.galleryEmpty}>
          <Ionicons name="cube-outline" size={72} color={colors.faint} />
        </View>
      )}
      {off ? (
        <View style={styles.galleryOff}>
          <Text style={styles.galleryOffText}>{off}% OFF</Text>
        </View>
      ) : null}
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
  gallery: {
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#EEF0F3',
    overflow: 'hidden',
  },
  galleryEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  galleryOff: { position: 'absolute', top: 12, left: 12, backgroundColor: colors.ok, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  galleryOffText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  dots: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { width: 18, backgroundColor: colors.primary },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: '#EEF0F3' },
  brandPill: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6 },
  brandText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  name: { fontSize: 21, fontWeight: '800', color: colors.text, lineHeight: 27 },
  path: { fontSize: 12, color: colors.muted, marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },
  price: { fontSize: 28, fontWeight: '900', color: colors.text },
  mrp: { fontSize: 14, color: colors.faint, textDecorationLine: 'line-through' },
  offPill: { backgroundColor: colors.okSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  offText: { color: colors.ok, fontSize: 12, fontWeight: '900' },
  priceSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  stock: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: space.md },
  stockDot: { width: 7, height: 7, borderRadius: 4 },
  stockText: { fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: space.md },
  pack: {
    width: 128,
    padding: space.md,
    paddingTop: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  packOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  bestTag: { position: 'absolute', top: -1, left: -1, backgroundColor: '#B76E00', borderTopLeftRadius: radius.md, borderBottomRightRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  bestText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  packName: { fontSize: 14, fontWeight: '700', color: colors.text },
  packPrice: { fontSize: 18, fontWeight: '900', color: colors.text, marginTop: 6 },
  packMeta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  packOff: { fontSize: 12, color: colors.ok, fontWeight: '800', marginTop: 2 },
  packOut: { fontSize: 11, color: colors.error, fontWeight: '700', marginTop: 2 },
  packCheck: { position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  qtyHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  rules: { fontSize: 12, color: colors.muted, flexShrink: 1, textAlign: 'right' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  qtyBtn: { width: 56, height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  qtyBtnOff: { borderColor: colors.border, backgroundColor: colors.bg },
  qtyValue: { flex: 1, height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  qtyNumber: { fontSize: 24, fontWeight: '900', color: colors.text, lineHeight: 28 },
  qtyUnit: { fontSize: 11, color: colors.muted },
  quick: { flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },
  quickChip: { minWidth: 52, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  quickOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  quickText: { fontSize: 14, fontWeight: '700', color: colors.text },
  pieces: { fontSize: 13, color: colors.muted, marginTop: space.md },
  perks: { flexDirection: 'row', gap: space.sm },
  perk: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#EEF0F3' },
  perkText: { fontSize: 11, color: colors.text, textAlign: 'center', fontWeight: '600', lineHeight: 14 },
  featureRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: space.sm, borderRadius: 6 },
  featureAlt: { backgroundColor: colors.bg },
  featureLabel: { flex: 1, color: colors.muted, fontSize: 14 },
  featureValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  description: { fontSize: 15, color: colors.text, lineHeight: 22 },
  footer: { paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  footerPrice: { fontSize: 22, fontWeight: '900', color: colors.text },
  footerSub: { fontSize: 12, color: colors.muted },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 170, height: 52, borderRadius: radius.md, backgroundColor: colors.primary },
  ctaGo: { backgroundColor: colors.ok },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  unavailable: { fontSize: 15, fontWeight: '700', color: colors.faint },
});
