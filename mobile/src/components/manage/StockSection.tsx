import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Banner, Button } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { stockText } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { LedgerEntry, ManageProduct } from '@/lib/types';

type Kind = 'received' | 'count' | 'remove';

const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: 'received', label: 'Stock received', hint: 'Adds to stock (purchase)' },
  { key: 'count', label: 'Counted stock', hint: 'Sets stock to what you counted (in pieces)' },
  { key: 'remove', label: 'Remove', hint: 'Damaged, expired or used (reduces stock)' },
];

const REASON_LABEL: Record<string, string> = {
  opening: 'Opening stock',
  purchase: 'Received',
  dispatch: 'Dispatched',
  adjust: 'Adjusted',
  return: 'Returned',
};

export function StockSection({ product, base, onChanged }: { product: ManageProduct; base: string; onChanged: () => void }) {
  const [kind, setKind] = useState<Kind>('received');
  const [qty, setQty] = useState('');
  const [unitId, setUnitId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const ledger = useQuery({
    queryKey: ['ledger', product.id],
    queryFn: () => api<LedgerEntry[]>(`${base}/stock/ledger`, { query: { product_id: product.id, limit: 10 } }),
  });

  const unit = product.units.find((u) => u.id === unitId) ?? product.units.find((u) => u.is_default) ?? product.units[0];
  const n = Number(qty);
  const valid = qty.trim() !== '' && Number.isInteger(n) && (kind === 'count' ? n >= 0 : n > 0);

  const save = useMutation({
    mutationFn: () => {
      const body =
        kind === 'count'
          ? { product_id: product.id, set_to: n, reason: 'adjust', note: note.trim() || 'Stock count' }
          : {
              product_id: product.id,
              change: kind === 'received' ? n : -n,
              unit_id: unit && unit.pieces_per_unit > 1 ? unit.id : undefined,
              reason: kind === 'received' ? 'purchase' : 'adjust',
              note: note.trim() || null,
            };
      return api<{ change_pieces: number; stock_pieces: number }>(`${base}/stock/adjust`, { method: 'POST', body });
    },
    onSuccess: (r) => {
      setDone(`Stock is now ${r.stock_pieces} pieces (${r.change_pieces >= 0 ? '+' : ''}${r.change_pieces}).`);
      setQty('');
      setNote('');
      onChanged();
      void ledger.refetch();
    },
  });

  return (
    <View>
      <Text style={styles.current}>{stockText(product)}</Text>
      <View style={styles.kinds}>
        {KINDS.map((k) => (
          <Pressable
            key={k.key}
            onPress={() => {
              setKind(k.key);
              setDone(null);
            }}
            style={[styles.kind, kind === k.key && styles.kindActive]}>
            <Text style={[styles.kindText, kind === k.key && { color: '#FFFFFF' }]}>{k.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>{KINDS.find((k) => k.key === kind)!.hint}</Text>

      <View style={styles.row}>
        <TextInput
          value={qty}
          onChangeText={(t) => setQty(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder={kind === 'count' ? 'Pieces counted' : 'How many'}
          placeholderTextColor={colors.faint}
          style={[styles.input, { flex: 1 }]}
        />
        {kind !== 'count' &&
          product.units.map((u) => (
            <Pressable key={u.id} onPress={() => setUnitId(u.id)} style={[styles.unit, unit?.id === u.id && styles.unitActive]}>
              <Text style={[styles.unitText, unit?.id === u.id && { color: colors.primaryDark }]}>{u.pieces_per_unit === 1 ? 'pcs' : u.name}</Text>
            </Pressable>
          ))}
      </View>
      <TextInput value={note} onChangeText={setNote} placeholder="Note (optional), e.g. bill no." placeholderTextColor={colors.faint} style={[styles.input, { marginTop: space.sm }]} />
      {save.isError && <Banner kind="error" text={errorText(save.error)} />}
      {done && <Banner kind="ok" text={done} />}
      <Button title="Save stock" onPress={() => save.mutate()} loading={save.isPending} disabled={!valid} style={{ marginTop: space.sm }} />

      <Text style={styles.historyTitle}>Recent stock changes</Text>
      {(ledger.data ?? []).map((e) => (
        <View key={e.id} style={styles.entry}>
          <View style={{ flex: 1 }}>
            <Text style={styles.entryTitle}>{REASON_LABEL[e.reason] ?? e.reason}</Text>
            <Text style={styles.entryMeta}>
              {dateTime(e.created_at)}
              {e.note ? ` · ${e.note}` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.change, { color: e.change_pieces < 0 ? colors.error : colors.ok }]}>
              {e.change_pieces > 0 ? '+' : ''}
              {e.change_pieces}
            </Text>
            <Text style={styles.entryMeta}>= {e.balance_after}</Text>
          </View>
        </View>
      ))}
      {ledger.data?.length === 0 && <Text style={styles.entryMeta}>No changes yet.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  current: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: space.sm },
  kinds: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  kind: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  kindActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindText: { fontWeight: '600', color: colors.text, fontSize: 13 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, marginBottom: space.sm },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.md, fontSize: 16, backgroundColor: colors.card, color: colors.text },
  unit: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  unitActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  unitText: { fontWeight: '600', color: colors.text },
  historyTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: space.xl, marginBottom: space.sm },
  entry: { flexDirection: 'row', paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  entryTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  entryMeta: { fontSize: 12, color: colors.muted },
  change: { fontSize: 15, fontWeight: '800' },
});
