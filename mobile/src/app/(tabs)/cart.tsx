import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ProductStrip } from '@/components/ProductStrip';
import { AddControl } from '@/components/shop/ProductTile';
import { Banner, Button, Empty, ErrorView, Loading, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useCartActions } from '@/lib/cartActions';
import { cartKey, useCart, useWorkspace, type Workspace } from '@/lib/data';
import { inr, mediaUrl, packName } from '@/lib/format';
import { shopParam } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';
import type { Cart, CartLine, Shop } from '@/lib/types';

export default function CartScreen() {
  const ws = useWorkspace();
  const router = useRouter();
  if (ws.loading) return <Loading />;
  if (!ws.current) return <Empty icon="cart-outline" title="No distributor yet" text="Add a distributor to start ordering." />;
  if (ws.current.mode === 'agent' && !ws.current.agentShop) {
    return (
      <Empty
        icon="people-outline"
        title="Choose a shop"
        text="Each shop you order for has its own cart."
        action={<Button title="Choose shop" onPress={() => router.push('/agent/shops')} />}
      />
    );
  }
  return <CartView ws={ws.current} shop={ws.me.data?.shop ?? null} />;
}

function CartView({ ws, shop }: { ws: Workspace; shop: Shop | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const cart = useCart(ws);
  const actions = useCartActions(ws);
  const base = `/t/${ws.tenantId}`;
  const query = shopParam(ws.mode, ws.agentShop);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  // Save the note, then show the review screen. Nothing is ordered until the buyer confirms there.
  const review = useMutation({
    mutationFn: async () => {
      if (noteDraft !== null && noteDraft !== (cart.data?.note ?? '')) {
        const updated = await api<Cart>(`${base}/cart/note`, { method: 'PUT', body: { note: noteDraft }, query });
        qc.setQueryData(cartKey(ws), updated);
      }
    },
    onSuccess: () => router.push('/checkout'),
    onError: (err) => Alert.alert("Couldn't save the note", errorText(err)),
  });

  if (cart.isLoading) return <SkeletonList count={3} />;
  if (cart.isError) return <ErrorView message={errorText(cart.error)} onRetry={() => cart.refetch()} />;
  const data = cart.data!;

  if (!data.items.length) {
    return (
      <ScrollView contentContainerStyle={styles.emptyWrap}>
        <View style={styles.emptyIcon}>
          <Ionicons name="cart-outline" size={44} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>Your cart is empty</Text>
        <Text style={styles.emptyText}>
          {ws.mode === 'agent' ? `Add products for ${ws.agentShop?.name}.` : 'Add products from the shop to place an order.'}
        </Text>
        <Button title="Start shopping" icon="storefront-outline" onPress={() => router.navigate('/home')} style={{ alignSelf: 'stretch', marginTop: space.lg }} />
        <View style={{ alignSelf: 'stretch', marginTop: space.md }}>
          <ProductStrip title="Your usual items" ws={ws} path="/cart/suggestions" />
        </View>
      </ScrollView>
    );
  }

  const problems = data.items.filter((i) => i.problem).length;
  const deliverTo =
    ws.mode === 'agent'
      ? { name: ws.agentShop?.name ?? '', address: 'Order placed by you as agent' }
      : shop
        ? { name: shop.shop_name, address: [shop.address, shop.city].filter(Boolean).join(', ') }
        : null;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: space.md, paddingBottom: space.xl, gap: space.md }}
        refreshControl={<RefreshControl refreshing={cart.isRefetching} onRefresh={() => void cart.refetch()} />}
        keyboardShouldPersistTaps="handled">
        {deliverTo && (
          <View style={[styles.card, styles.deliver]}>
            <View style={styles.deliverIcon}>
              <Ionicons name="location" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.deliverLabel}>Delivering to</Text>
              <Text style={styles.deliverName}>{deliverTo.name}</Text>
              {deliverTo.address ? (
                <Text style={styles.deliverAddress} numberOfLines={2}>
                  {deliverTo.address}
                </Text>
              ) : null}
            </View>
          </View>
        )}

        {problems > 0 && <Banner kind="error" text={`${problems} item${problems > 1 ? 's need' : ' needs'} attention before you can order.`} />}

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>From {ws.name}</Text>
            <Text style={styles.cardMeta}>
              {data.item_count} item{data.item_count === 1 ? '' : 's'}
            </Text>
          </View>
          {data.items.map((item, i) => (
            <Line
              key={item.id}
              line={item}
              first={i === 0}
              busy={actions.busy === item.id}
              onQty={(qty) => actions.setQty(item.id, item, qty)}
              onRemove={() => actions.remove(item.id, item)}
              onOpen={() => router.push(`/product/${item.product_id}`)}
            />
          ))}
          <Pressable onPress={() => router.navigate('/home')} style={styles.addMore}>
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.addMoreText}>Add more items</Text>
          </Pressable>
        </View>

        <View style={[styles.card, { paddingLeft: space.lg, paddingVertical: space.sm }]}>
          <ProductStrip title="You may also need" ws={ws} path="/cart/suggestions" />
          <View style={{ height: space.sm }} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Note for the distributor</Text>
          <TextInput
            value={noteDraft ?? data.note ?? ''}
            onChangeText={setNoteDraft}
            placeholder="e.g. deliver before 10 am"
            placeholderTextColor={colors.faint}
            style={styles.note}
            multiline
            maxLength={500}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bill details</Text>
          <BillRow label={`Items total (${data.item_count})`} value={inr(data.total)} />
          <BillRow label="Delivery" value="As agreed with distributor" muted />
          <View style={styles.billDivider} />
          <BillRow label="To pay" value={inr(data.total)} strong />
          <View style={styles.payNote}>
            <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
            <Text style={styles.payNoteText}>
              No online payment. The distributor approves the order first, then you pay them as usual.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.total}>{inr(data.total)}</Text>
        </View>
        <Button
          title="Review order"
          icon="arrow-forward-circle-outline"
          onPress={() => review.mutate()}
          loading={review.isPending}
          disabled={!data.can_place_order || actions.busy !== undefined}
          style={{ minWidth: 180 }}
        />
      </View>
    </View>
  );
}

function BillRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, strong && styles.billStrong]}>{label}</Text>
      <Text style={[styles.billValue, strong && styles.billStrong, muted && { color: colors.muted, fontWeight: '400' }]}>{value}</Text>
    </View>
  );
}

function Line({
  line,
  first,
  busy,
  onQty,
  onRemove,
  onOpen,
}: {
  line: CartLine;
  first: boolean;
  busy: boolean;
  onQty: (qty: number) => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  return (
    <View style={[styles.line, !first && styles.lineBorder]}>
      <Pressable onPress={onOpen} style={styles.thumb}>
        {line.image ? (
          <Image source={{ uri: mediaUrl(line.image) }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Ionicons name="cube-outline" size={24} color={colors.faint} />
        )}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Pressable onPress={onOpen}>
          <Text style={styles.lineName} numberOfLines={2}>
            {line.product_name}
          </Text>
        </Pressable>
        <Text style={styles.lineMeta}>
          {packName(line.unit_name, line.pieces_per_unit)} · {inr(line.price)} each
        </Text>
        {line.problem && (
          <View style={styles.problemRow}>
            <Text style={styles.problem}>{line.problem}</Text>
            <Pressable onPress={onRemove} hitSlop={8}>
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.lineBottom}>
          <AddControl unit={line} line={line} busy={busy} onAdd={() => undefined} onQty={onQty} />
          <Text style={styles.lineTotal}>{inr(line.line_total)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: space.lg },
  emptyText: { fontSize: 14, color: colors.muted, marginTop: 4, textAlign: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  deliver: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  deliverIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  deliverLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  deliverName: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 1 },
  deliverAddress: { fontSize: 13, color: colors.muted, marginTop: 2 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space.xs },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  cardMeta: { fontSize: 13, color: colors.muted },
  line: { flexDirection: 'row', paddingVertical: space.md, gap: space.md },
  lineBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: '#F3F5F7',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineName: { fontSize: 15, fontWeight: '600', color: colors.text },
  lineMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  problemRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 4 },
  problem: { flex: 1, fontSize: 13, color: colors.error, fontWeight: '600' },
  removeText: { fontSize: 13, color: colors.error, fontWeight: '700', textDecorationLine: 'underline' },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  lineTotal: { fontSize: 16, fontWeight: '800', color: colors.text },
  addMore: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  addMoreText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  note: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space.md,
    marginTop: space.sm,
    fontSize: 15,
    backgroundColor: colors.bg,
    color: colors.text,
    textAlignVertical: 'top',
  },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm },
  billLabel: { fontSize: 14, color: colors.text },
  billValue: { fontSize: 14, color: colors.text, fontWeight: '600' },
  billStrong: { fontSize: 16, fontWeight: '800' },
  billDivider: { height: 1, backgroundColor: colors.border, marginTop: space.md, marginBottom: 2, borderStyle: 'dashed' },
  payNote: { flexDirection: 'row', gap: 6, marginTop: space.md, backgroundColor: colors.bg, borderRadius: radius.sm, padding: space.sm },
  payNoteText: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 17 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: 12, color: colors.muted },
  total: { fontSize: 22, fontWeight: '800', color: colors.text },
});
