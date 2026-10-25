import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddControl } from '@/components/shop/ProductTile';
import { api, errorText } from '@/lib/api';
import { useCartActions } from '@/lib/cartActions';
import { useCart, type Workspace } from '@/lib/data';
import { inr, mediaUrl, packName, saving } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';
import type { CatalogCard, CatalogDetail } from '@/lib/types';

/** "Choose a size" sheet: every size of a product with its own price and ADD button (like Blinkit's options). */
export function SizeSheet({ ws, product, onClose }: { ws: Workspace; product: CatalogCard; onClose: () => void }) {
  const router = useRouter();
  const detail = useQuery({
    queryKey: ['product', ws.tenantId, product.id],
    queryFn: () => api<CatalogDetail>(`/t/${ws.tenantId}/catalog/products/${product.id}`),
  });
  const cart = useCart(ws);
  const actions = useCartActions(ws);
  const lines = useMemo(() => new Map((cart.data?.items ?? []).map((l) => [l.unit_id, l])), [cart.data]);
  const variants = detail.data?.variants ?? [];
  const sizes = variants.length ? variants : detail.data ? [product] : [];
  const locked = ws.mode === 'agent' && !ws.agentShop;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>
              {product.brand ? `${product.brand} · ` : ''}Choose a size
            </Text>
            <Text style={styles.sub}>{sizes.length ? `${sizes.length} sizes` : ' '}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>
        {detail.isLoading ? (
          <ActivityIndicator style={{ margin: space.xl }} color={colors.primary} />
        ) : detail.isError ? (
          <Text style={[styles.sub, { padding: space.lg }]}>{errorText(detail.error)}</Text>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm }}>
            {sizes.map((s) => {
              const u = s.default_unit;
              const off = saving(s.mrp, u.price, u.pieces_per_unit);
              const sellable = s.in_stock && u.in_stock;
              const line = lines.get(u.id);
              return (
                <View key={s.id} style={[styles.row, line && styles.rowOn]}>
                  <Pressable
                    onPress={() => {
                      onClose();
                      router.push(`/product/${s.id}`);
                    }}
                    style={styles.rowMain}>
                    <View style={styles.thumb}>
                      {s.image ? (
                        <Image source={{ uri: mediaUrl(s.image) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <Ionicons name="cube-outline" size={22} color={colors.faint} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.size}>{s.variant_label || s.name}</Text>
                      <Text style={styles.pack} numberOfLines={1}>
                        {packName(u.name, u.pieces_per_unit)}
                      </Text>
                      <View style={styles.priceRow}>
                        <Text style={styles.price}>{inr(u.price)}</Text>
                        {off ? <Text style={styles.mrp}>{inr(off.mrp)}</Text> : null}
                        {off ? <Text style={styles.off}>{off.percent}% off</Text> : null}
                      </View>
                    </View>
                  </Pressable>
                  {sellable ? (
                    <AddControl
                      unit={u}
                      line={line}
                      name={s.name}
                      busy={actions.busy === s.id}
                      disabled={locked}
                      onAdd={() => actions.add(s.id, u, undefined, s.name)}
                      onQty={(qty) => line && actions.setQty(s.id, line, qty)}
                    />
                  ) : (
                    <Text style={styles.out}>Out of stock</Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', padding: space.lg, paddingBottom: space.md },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: '#F4F6F8', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  size: { fontSize: 16, fontWeight: '800', color: colors.text },
  pack: { fontSize: 12, color: colors.muted, marginTop: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 3 },
  price: { fontSize: 15, fontWeight: '800', color: colors.text },
  mrp: { fontSize: 12, color: colors.faint, textDecorationLine: 'line-through' },
  off: { fontSize: 12, color: colors.ok, fontWeight: '700' },
  out: { fontSize: 12, color: colors.error, fontWeight: '700' },
});
