import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Banner, Button, Card, ErrorView, Loading, QtyStepper, SectionTitle, StatusBadge } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { downloadAndShare } from '@/lib/files';
import { dateTime, inr, packLabel, STATUS_LABEL } from '@/lib/format';
import { useManage, useRefreshManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { Order, OrderItem } from '@/lib/types';
import { mapsUrl } from '@/components/LocationField';

type ShortLine = { item_id: string; product_name: string; unit_name: string; qty_wanted: number; qty_possible: number };

export default function ManageOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { base, tenantId } = useManage();
  if (!tenantId) return <Loading />;
  return <OrderView id={id} base={base} />;
}

function OrderView({ id, base }: { id: string; base: string }) {
  const refresh = useRefreshManage();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api<Order>(`${base}/orders/${id}`) });
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [short, setShort] = useState<ShortLine[] | null>(null);
  const [sharing, setSharing] = useState(false);

  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body: unknown }) =>
      api<Order>(`${base}/orders/${id}/${action}`, { method: 'POST', body }),
    onSuccess: async () => {
      setEdits({});
      setNote('');
      setRejecting(false);
      setShort(null);
      await refresh();
    },
    onError: (err) => {
      const detail = err instanceof ApiError ? (err.detail as { short?: ShortLine[] } | undefined) : undefined;
      if (detail?.short?.length) {
        // Not enough stock: reduce those lines to what can go, and let the user dispatch again.
        setShort(detail.short);
        setEdits((e) => ({ ...e, ...Object.fromEntries(detail.short!.map((s) => [s.item_id, s.qty_possible])) }));
        return;
      }
      Alert.alert("Couldn't do that", errorText(err));
    },
  });

  if (order.isLoading) return <Loading />;
  if (order.isError) return <ErrorView message={errorText(order.error)} onRetry={() => order.refetch()} />;
  const o = order.data!;
  const pending = o.status === 'pending';
  const approved = o.status === 'approved';
  const editable = pending || approved;

  const base_qty = (i: OrderItem) => (pending ? i.qty_ordered : (i.qty_approved ?? i.qty_ordered));
  const qtyOf = (i: OrderItem) => edits[i.id] ?? (editable ? base_qty(i) : i.qty);
  const changed = o.items.filter((i) => qtyOf(i) !== base_qty(i)).map((i) => ({ item_id: i.id, qty: qtyOf(i) }));
  const total = o.items.reduce((sum, i) => sum + i.rate * qtyOf(i), 0);
  const nothingLeft = o.items.every((i) => qtyOf(i) === 0);

  function confirm(title: string, message: string, onYes: () => void) {
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel' },
      { text: title, onPress: onYes },
    ]);
  }

  async function shareBill() {
    setSharing(true);
    try {
      await downloadAndShare(`${base}/orders/${id}/bill.pdf`, `order-${o.order_no}.pdf`, 'application/pdf', `Order #${o.order_no}`);
    } catch (err) {
      Alert.alert("Couldn't get the bill", errorText(err));
    } finally {
      setSharing(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={order.isRefetching} onRefresh={() => void order.refetch()} />}>
      <Stack.Screen options={{ title: `Order #${o.order_no}` }} />

      <Card>
        <View style={styles.row}>
          <Text style={styles.title}>{o.shop_name}</Text>
          <StatusBadge status={o.status} />
        </View>
        <Text style={styles.meta}>{o.shop_address}</Text>
        <Text style={styles.meta}>
          {dateTime(o.created_at)}
          {o.source === 'agent' ? ` · by agent ${o.placed_by_name}` : o.source === 'admin' ? ` · by ${o.placed_by_name}` : ''}
        </Text>
        <View style={styles.contactRow}>
          {o.shop_phone && (
            <Pressable onPress={() => Linking.openURL(`tel:${o.shop_phone}`)} style={styles.call}>
              <Ionicons name="call-outline" size={16} color={colors.primary} />
              <Text style={styles.callText}>Call {o.shop_phone}</Text>
            </Pressable>
          )}
          {o.shop_lat != null && o.shop_lng != null && (
            <Pressable onPress={() => Linking.openURL(mapsUrl(o.shop_lat!, o.shop_lng!))} style={styles.call}>
              <Ionicons name="navigate-outline" size={16} color={colors.primary} />
              <Text style={styles.callText}>Open in Maps</Text>
            </Pressable>
          )}
        </View>
        {o.note ? <Banner kind="info" text={`Shop's note: ${o.note}`} /> : null}
      </Card>

      {short && (
        <View style={{ marginTop: space.md }}>
          <Banner
            kind="warn"
            text={`Not enough stock: ${short
              .map((s) => `${s.product_name} (${s.unit_name}) ${s.qty_wanted} → ${s.qty_possible}`)
              .join('; ')}. Quantities were reduced to what you have. Check and tap Dispatch again.`}
          />
        </View>
      )}

      <SectionTitle>
        {pending ? 'Items · change quantities before approving' : approved ? 'Items · you can send less than approved' : 'Items'}
      </SectionTitle>
      <Card style={{ paddingVertical: space.sm }}>
        {o.items.map((item, i) => {
          const qty = qtyOf(item);
          return (
            <View key={item.id} style={[styles.item, i > 0 && styles.itemBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, qty === 0 && styles.struck]}>{item.product_name}</Text>
                <Text style={styles.small}>
                  {packLabel(item.unit_name, item.pieces_per_unit)} @ {inr(item.rate)}
                  {qty !== item.qty_ordered ? ` · ordered ${item.qty_ordered}` : ''}
                </Text>
                {!editable && <Text style={styles.small}>Qty {qty}</Text>}
              </View>
              {editable ? (
                <QtyStepper
                  value={qty}
                  min={0}
                  step={1}
                  max={approved ? (item.qty_approved ?? item.qty_ordered) : null}
                  onChange={(n) => setEdits((e) => ({ ...e, [item.id]: n }))}
                  disabled={act.isPending}
                />
              ) : (
                <Text style={styles.itemTotal}>{inr(item.line_total)}</Text>
              )}
            </View>
          );
        })}
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.total}>{inr(editable ? total : o.items_total)}</Text>
        </View>
      </Card>

      {editable && (
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={rejecting ? 'Reason for rejecting (shop will see this)' : 'Note for the shop (optional)'}
          placeholderTextColor={colors.faint}
          style={[styles.note, rejecting && { borderColor: colors.error }]}
          multiline
          maxLength={500}
        />
      )}

      <View style={{ gap: space.md, marginTop: space.lg }}>
        {pending && !rejecting && (
          <>
            <Button
              title={changed.length ? `Approve with ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'Approve'}
              icon="checkmark-circle-outline"
              disabled={nothingLeft}
              loading={act.isPending}
              onPress={() => act.mutate({ action: 'approve', body: { items: changed, note: note.trim() || null } })}
            />
            <Button title="Reject" variant="danger" onPress={() => setRejecting(true)} />
          </>
        )}
        {pending && rejecting && (
          <>
            <Button
              title="Reject order"
              variant="danger"
              disabled={!note.trim()}
              loading={act.isPending}
              onPress={() => act.mutate({ action: 'reject', body: { reason: note.trim() } })}
            />
            <Button title="Don't reject" variant="ghost" onPress={() => setRejecting(false)} />
          </>
        )}
        {approved && (
          <>
            <Button
              title="Dispatch (stock goes down now)"
              icon="car-outline"
              disabled={nothingLeft}
              loading={act.isPending}
              onPress={() =>
                confirm('Dispatch', 'Stock will be reduced for every item sent.', () =>
                  act.mutate({ action: 'dispatch', body: { items: changed, note: note.trim() || null } }),
                )
              }
            />
            <Button
              title="Cancel order"
              variant="danger"
              onPress={() => confirm('Cancel order', 'The shop will see it as cancelled.', () => act.mutate({ action: 'cancel', body: { note: note.trim() || null } }))}
            />
          </>
        )}
        {o.status === 'dispatched' && (
          <Button title="Mark delivered" icon="checkmark-done-outline" loading={act.isPending} onPress={() => act.mutate({ action: 'deliver', body: {} })} />
        )}
        <Button title="Share bill (PDF)" icon="share-outline" variant="secondary" loading={sharing} onPress={shareBill} />
      </View>

      <SectionTitle>Progress</SectionTitle>
      <Card>
        {o.events.map((e) => (
          <View key={`${e.to_status}-${e.at}`} style={{ marginBottom: space.sm }}>
            <Text style={styles.eventTitle}>{STATUS_LABEL[e.to_status] ?? e.to_status}</Text>
            <Text style={styles.small}>
              {dateTime(e.at)}
              {e.by_name ? ` · ${e.by_name}` : ''}
            </Text>
            {e.note ? <Text style={styles.eventNote}>{e.note}</Text> : null}
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, flex: 1, marginRight: space.sm },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg },
  call: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md, marginBottom: space.sm },
  callText: { color: colors.primary, fontWeight: '700' },
  small: { fontSize: 12, color: colors.muted, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, gap: space.sm },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  itemName: { fontSize: 15, fontWeight: '600', color: colors.text },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  itemTotal: { fontSize: 15, fontWeight: '700', color: colors.text },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, marginTop: space.sm },
  totalLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  total: { fontSize: 20, fontWeight: '800', color: colors.text },
  note: {
    marginTop: space.md,
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space.md,
    fontSize: 15,
    backgroundColor: colors.card,
    color: colors.text,
    textAlignVertical: 'top',
  },
  eventTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  eventNote: { fontSize: 13, color: colors.text, backgroundColor: colors.bg, borderRadius: radius.sm, padding: space.sm, marginTop: 4 },
});
