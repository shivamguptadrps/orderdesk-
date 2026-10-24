import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Card, ErrorView, firstQty, Loading, QtyStepper, SectionTitle } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { cartKey, useWorkspace, type Workspace } from '@/lib/data';
import { inr, mediaUrl, packLabel } from '@/lib/format';
import { shopParam } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';
import type { Cart, CatalogDetail, Unit } from '@/lib/types';

const WIDTH = Dimensions.get('window').width;

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useWorkspace();
  if (ws.loading) return <Loading />;
  if (!ws.current) return <ErrorView message="Choose a distributor first." />;
  return <Product id={id} ws={ws.current} />;
}

function Product({ id, ws }: { id: string; ws: Workspace }) {
  const router = useRouter();
  const qc = useQueryClient();
  const product = useQuery({
    queryKey: ['product', ws.tenantId, id],
    queryFn: () => api<CatalogDetail>(`/t/${ws.tenantId}/catalog/products/${id}`),
  });
  const [unitId, setUnitId] = useState<string | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (body: { unit_id: string; qty: number }) =>
      api<Cart>(`/t/${ws.tenantId}/cart/items`, { method: 'POST', body, query: shopParam(ws.mode, ws.agentShop) }),
    onSuccess: (cart, body) => {
      qc.setQueryData(cartKey(ws), cart);
      const unit = product.data?.units.find((u) => u.id === body.unit_id);
      setAdded(`Added ${body.qty} ${unit?.name ?? ''} to cart`);
    },
  });

  if (product.isLoading) return <Loading />;
  if (product.isError) return <ErrorView message={errorText(product.error)} onRetry={() => product.refetch()} />;
  const p = product.data!;
  const unit = p.units.find((u) => u.id === unitId) ?? p.units.find((u) => u.is_default) ?? p.units[0];
  const quantity = qty ?? firstQty(unit.min_qty, unit.step_qty);
  const needsShop = ws.mode === 'agent' && !ws.agentShop;

  function pickUnit(u: Unit) {
    setUnitId(u.id);
    setQty(firstQty(u.min_qty, u.step_qty));
    add.reset();
    setAdded(null);
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <Stack.Screen options={{ title: p.brand ?? '' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <Gallery images={p.images} />
        <View style={{ padding: space.lg }}>
          <Text style={styles.path}>{p.category_path.join(' › ')}</Text>
          <Text style={styles.name}>{p.name}</Text>
          {p.mrp !== null && <Text style={styles.mrp}>MRP {inr(p.mrp)} per piece</Text>}
          {!p.in_stock && <Banner kind="error" text="Out of stock right now" />}

          <SectionTitle>Pack size</SectionTitle>
          {p.units.map((u) => (
            <Pressable key={u.id} onPress={() => pickUnit(u)} style={[styles.unit, u.id === unit.id && styles.unitActive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.unitName}>{packLabel(u.name, u.pieces_per_unit)}</Text>
                <Text style={styles.unitMeta}>
                  {u.pieces_per_unit > 1 ? `${inr(u.price_per_piece)} per piece · ` : ''}
                  {u.min_qty > 1 ? `min ${u.min_qty} · ` : ''}
                  {u.step_qty > 1 ? `in multiples of ${u.step_qty}` : ''}
                  {!u.in_stock ? 'not enough stock' : ''}
                </Text>
              </View>
              <Text style={styles.unitPrice}>{inr(u.price)}</Text>
            </Pressable>
          ))}

          {p.features.length > 0 && (
            <>
              <SectionTitle>Details</SectionTitle>
              <Card style={{ paddingVertical: space.sm }}>
                {p.features.map((f, i) => (
                  <View key={f.key} style={[styles.featureRow, i > 0 && styles.featureBorder]}>
                    <Text style={styles.featureLabel}>{f.label}</Text>
                    <Text style={styles.featureValue}>
                      {typeof f.value === 'boolean' ? (f.value ? 'Yes' : 'No') : String(f.value)}
                      {f.unit ? ` ${f.unit}` : ''}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          )}
          {p.description ? (
            <>
              <SectionTitle>About</SectionTitle>
              <Text style={styles.description}>{p.description}</Text>
            </>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {added && !add.isPending ? (
          <View style={styles.addedRow}>
            <Ionicons name="checkmark-circle" size={20} color={colors.ok} />
            <Text style={styles.addedText}>{added}</Text>
            <Button title="View cart" variant="ghost" onPress={() => router.navigate('/cart')} />
          </View>
        ) : null}
        {add.isError && <Banner kind="error" text={errorText(add.error)} />}
        {needsShop && <Banner kind="warn" text="Choose the shop you are ordering for first." />}
        <View style={styles.row}>
          <QtyStepper
            value={quantity}
            min={unit.min_qty}
            step={unit.step_qty}
            max={unit.max_qty}
            onChange={(n) => {
              setQty(n);
              setAdded(null);
            }}
          />
          <Button
            title={`Add · ${inr(unit.price * quantity)}`}
            onPress={() => add.mutate({ unit_id: unit.id, qty: quantity })}
            loading={add.isPending}
            disabled={needsShop || !unit.in_stock}
            style={{ flex: 1, marginLeft: space.md }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Gallery({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0);
  if (!images.length) {
    return (
      <View style={[styles.gallery, { alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="cube-outline" size={64} color={colors.faint} />
      </View>
    );
  }
  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / WIDTH))}>
        {images.map((url) => (
          <Image key={url} source={{ uri: mediaUrl(url) }} style={styles.gallery} contentFit="contain" transition={150} />
        ))}
      </ScrollView>
      {images.length > 1 && (
        <View style={styles.dots}>
          {images.map((url, i) => (
            <View key={url} style={[styles.dot, i === index && { backgroundColor: colors.primary }]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  gallery: { width: WIDTH, height: WIDTH * 0.8, backgroundColor: colors.card },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: space.sm, backgroundColor: colors.card },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  path: { fontSize: 12, color: colors.muted, marginBottom: 4 },
  name: { fontSize: 22, fontWeight: '800', color: colors.text },
  mrp: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: space.sm },
  unit: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginBottom: space.sm,
  },
  unitActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  unitName: { fontSize: 16, fontWeight: '700', color: colors.text },
  unitMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  unitPrice: { fontSize: 17, fontWeight: '800', color: colors.text },
  featureRow: { flexDirection: 'row', paddingVertical: space.sm },
  featureBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  featureLabel: { flex: 1, color: colors.muted, fontSize: 14 },
  featureValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  description: { fontSize: 15, color: colors.text, lineHeight: 22 },
  footer: {
    padding: space.lg,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addedRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm, gap: 6 },
  addedText: { flex: 1, color: colors.ok, fontWeight: '600' },
});
