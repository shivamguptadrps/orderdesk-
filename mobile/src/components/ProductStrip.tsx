import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AddControl } from '@/components/shop/ProductTile';
import { Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useCartActions } from '@/lib/cartActions';
import { useCart, type Workspace } from '@/lib/data';
import { inr, mediaUrl, packName, saving } from '@/lib/format';
import { shopParam } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';
import type { CatalogCard } from '@/lib/types';

const CARD_WIDTH = 150;

/**
 * A sideways row of products with the same ADD / − qty + control as the grid.
 * Used for "Buy again", "Customers also buy" and "You may also need". Shows nothing when empty.
 */
export function ProductStrip({ title, ws, path }: { title: string; ws: Workspace; path: string }) {
  const router = useRouter();
  const cart = useCart(ws);
  const actions = useCartActions(ws);
  const items = useQuery({
    queryKey: ['strip', ws.tenantId, path, ws.agentShop?.id ?? null],
    queryFn: () => api<CatalogCard[]>(`/t/${ws.tenantId}${path}`, { query: shopParam(ws.mode, ws.agentShop) }),
  });
  const lines = useMemo(() => new Map((cart.data?.items ?? []).map((l) => [l.unit_id, l])), [cart.data]);
  const needsShop = ws.mode === 'agent' && !ws.agentShop;

  if (items.isLoading) {
    return (
      <View>
        <Text style={styles.title}>{title}</Text>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={CARD_WIDTH} height={220} style={{ borderRadius: radius.md }} />
          ))}
        </View>
      </View>
    );
  }
  if (!items.data?.length) return null;

  return (
    <View>
      <Text style={styles.title}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingRight: space.lg, paddingBottom: 2 }}>
        {items.data.map((p) => {
          const u = p.default_unit;
          const off = saving(p.mrp, u.price, u.pieces_per_unit);
          const line = lines.get(u.id);
          return (
            <Pressable key={p.id} onPress={() => router.push(`/product/${p.id}`)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}>
              <View style={styles.imageBox}>
                {p.image ? (
                  <Image source={{ uri: mediaUrl(p.image) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                ) : (
                  <Ionicons name="cube-outline" size={30} color={colors.faint} />
                )}
                {off ? (
                  <View style={styles.offBadge}>
                    <Text style={styles.offText}>{off.percent}% OFF</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={2}>
                  {p.name}
                </Text>
                <Text style={styles.pack} numberOfLines={1}>
                  {packName(u.name, u.pieces_per_unit)}
                </Text>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>{inr(u.price)}</Text>
                  {off ? <Text style={styles.mrp}>{inr(off.mrp)}</Text> : null}
                </View>
                <AddControl
                  unit={u}
                  line={line}
                  busy={actions.busy === `strip-${p.id}`}
                  disabled={needsShop || !u.in_stock}
                  onAdd={() => actions.add(`strip-${p.id}`, u)}
                  onQty={(qty) => line && actions.setQty(`strip-${p.id}`, line, qty)}
                />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: space.lg, marginBottom: space.md },
  card: {
    width: CARD_WIDTH,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  imageBox: { height: 100, backgroundColor: '#F3F5F7', alignItems: 'center', justifyContent: 'center' },
  offBadge: {
    position: 'absolute',
    left: 0,
    top: 6,
    backgroundColor: colors.ok,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderTopRightRadius: 5,
    borderBottomRightRadius: 5,
  },
  offText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  body: { padding: space.sm, gap: 2 },
  name: { fontSize: 13, fontWeight: '600', color: colors.text, minHeight: 34, lineHeight: 17 },
  pack: { fontSize: 11, color: colors.muted },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 6 },
  price: { fontSize: 15, fontWeight: '800', color: colors.text },
  mrp: { fontSize: 11, color: colors.faint, textDecorationLine: 'line-through' },
});
