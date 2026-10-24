import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { Banner, Button, Empty, ErrorView, Loading, QtyStepper } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { cartKey, useCart, useRefreshOrders, useWorkspace, type Workspace } from '@/lib/data';
import { inr, mediaUrl, packLabel } from '@/lib/format';
import { shopParam } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';
import type { Cart, CartLine, Order } from '@/lib/types';

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
  return <CartView ws={ws.current} />;
}

function CartView({ ws }: { ws: Workspace }) {
  const router = useRouter();
  const qc = useQueryClient();
  const refreshOrders = useRefreshOrders();
  const cart = useCart(ws);
  const base = `/t/${ws.tenantId}`;
  const query = shopParam(ws.mode, ws.agentShop);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: (args: { method: 'PUT' | 'DELETE'; path: string; body?: unknown }) =>
      api<Cart>(`${base}${args.path}`, { method: args.method, body: args.body, query }),
    onSuccess: (data) => qc.setQueryData(cartKey(ws), data),
    onError: (err) => Alert.alert("Couldn't update cart", errorText(err)),
  });

  const place = useMutation({
    mutationFn: async () => {
      if (noteDraft !== null) await api<Cart>(`${base}/cart/note`, { method: 'PUT', body: { note: noteDraft }, query });
      return api<Order>(`${base}/orders`, { method: 'POST', body: {}, query });
    },
    onSuccess: async (order) => {
      setNoteDraft(null);
      await refreshOrders();
      router.push({ pathname: '/order/[id]', params: { id: order.id, tenant: order.tenant_id, placed: '1' } });
    },
    onError: async (err) => {
      await qc.invalidateQueries({ queryKey: cartKey(ws) });
      Alert.alert("Couldn't place order", errorText(err));
    },
  });

  if (cart.isLoading) return <Loading />;
  if (cart.isError) return <ErrorView message={errorText(cart.error)} onRetry={() => cart.refetch()} />;
  const data = cart.data!;

  if (!data.items.length) {
    return (
      <Empty
        icon="cart-outline"
        title="Your cart is empty"
        text={ws.mode === 'agent' ? `Add products for ${ws.agentShop?.name}.` : 'Browse products and add what you need.'}
        action={<Button title="Browse products" onPress={() => router.navigate('/home')} />}
      />
    );
  }

  const problems = data.items.filter((i) => i.problem).length;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={data.items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={cart.isRefetching} onRefresh={() => void cart.refetch()} />}
        ListHeaderComponent={
          <View>
            <Text style={styles.forText}>
              {ws.mode === 'agent' ? `Order for ${ws.agentShop?.name} · ` : ''}
              {ws.name}
            </Text>
            {problems > 0 && (
              <Banner kind="error" text={`${problems} item${problems > 1 ? 's need' : ' needs'} attention before you can order.`} />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Line
            line={item}
            busy={change.isPending}
            onQty={(qty) => change.mutate({ method: 'PUT', path: `/cart/items/${item.id}`, body: { qty } })}
            onRemove={() => change.mutate({ method: 'DELETE', path: `/cart/items/${item.id}` })}
          />
        )}
        ListFooterComponent={
          <View>
            <Text style={styles.noteLabel}>Note for the distributor (optional)</Text>
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
        }
      />
      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Text style={styles.totalLabel}>
            Total · {data.item_count} item{data.item_count > 1 ? 's' : ''}
          </Text>
          <Text style={styles.total}>{inr(data.total)}</Text>
        </View>
        <Button
          title="Place order"
          onPress={() => place.mutate()}
          loading={place.isPending}
          disabled={!data.can_place_order || change.isPending}
          style={{ minWidth: 150 }}
        />
      </View>
    </View>
  );
}

function Line({
  line,
  busy,
  onQty,
  onRemove,
}: {
  line: CartLine;
  busy: boolean;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  return (
    <View style={[styles.line, line.problem ? { borderColor: colors.error } : null]}>
      <View style={styles.thumb}>
        {line.image ? (
          <Image source={{ uri: mediaUrl(line.image) }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Ionicons name="cube-outline" size={24} color={colors.faint} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.lineName} numberOfLines={2}>
          {line.product_name}
        </Text>
        <Text style={styles.lineMeta}>
          {packLabel(line.unit_name, line.pieces_per_unit)} · {inr(line.price)} each
        </Text>
        {line.problem && <Text style={styles.problem}>{line.problem}</Text>}
        <View style={styles.lineBottom}>
          <QtyStepper value={line.qty} min={line.min_qty} step={line.step_qty} max={line.max_qty} onChange={onQty} disabled={busy} />
          <Text style={styles.lineTotal}>{inr(line.line_total)}</Text>
        </View>
      </View>
      <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel="Remove" disabled={busy} style={{ marginLeft: space.sm }}>
        <Ionicons name="trash-outline" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  forText: { color: colors.muted, fontSize: 13, marginBottom: space.sm },
  line: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  lineName: { fontSize: 15, fontWeight: '600', color: colors.text },
  lineMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  problem: { fontSize: 13, color: colors.error, fontWeight: '600', marginTop: 4 },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  lineTotal: { fontSize: 16, fontWeight: '800', color: colors.text },
  noteLabel: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: space.md, marginBottom: 6 },
  note: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space.md,
    fontSize: 15,
    backgroundColor: colors.card,
    color: colors.text,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.lg,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: 13, color: colors.muted },
  total: { fontSize: 22, fontWeight: '800', color: colors.text },
});
