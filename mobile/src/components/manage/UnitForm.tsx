import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { colors, radius, space } from '@/lib/theme';

/** A pack size as typed in the form (strings until saved). */
export type UnitDraft = {
  id?: string;
  name: string;
  pieces_per_unit: string;
  price: string;
  min_qty: string;
  step_qty: string;
  max_qty: string;
  is_default: boolean;
};

export const emptyUnit = (isDefault = false): UnitDraft => ({
  name: '',
  pieces_per_unit: '1',
  price: '',
  min_qty: '1',
  step_qty: '1',
  max_qty: '',
  is_default: isDefault,
});

/** Turn a draft into the API body, or return a problem to show. */
export function unitForApi(u: UnitDraft): { body?: Record<string, unknown>; error?: string } {
  const pieces = Number(u.pieces_per_unit);
  const price = Number(u.price.replace(/[₹,\s]/g, ''));
  const min = Number(u.min_qty || '1');
  const step = Number(u.step_qty || '1');
  const max = u.max_qty.trim() ? Number(u.max_qty) : null;
  if (!u.name.trim()) return { error: 'Every pack size needs a name (e.g. Piece, Box, Carton)' };
  if (!Number.isInteger(pieces) || pieces < 1) return { error: `${u.name}: pieces must be a whole number, 1 or more` };
  if (!Number.isFinite(price) || price < 0 || !u.price.trim()) return { error: `${u.name}: enter a price` };
  if (!Number.isInteger(min) || min < 1 || !Number.isInteger(step) || step < 1) return { error: `${u.name}: min and step must be whole numbers, 1 or more` };
  if (max !== null && (!Number.isInteger(max) || max < min)) return { error: `${u.name}: max must be a whole number, not less than min` };
  return {
    body: { name: u.name.trim(), pieces_per_unit: pieces, price: Math.round(price * 100) / 100, min_qty: min, step_qty: step, max_qty: max, is_default: u.is_default },
  };
}

export function UnitForm({
  value,
  onChange,
  onMakeDefault,
  footer,
}: {
  value: UnitDraft;
  onChange: (u: UnitDraft) => void;
  onMakeDefault: () => void;
  footer?: React.ReactNode;
}) {
  const set = (key: keyof UnitDraft) => (text: string) => onChange({ ...value, [key]: text });
  const pieces = Number(value.pieces_per_unit);
  const price = Number(value.price);
  const perPiece = pieces > 1 && price > 0 ? ` · ₹${(price / pieces).toFixed(2)} per piece` : '';

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Cell label="Name" flex={2}>
          <TextInput value={value.name} onChangeText={set('name')} placeholder="Carton" placeholderTextColor={colors.faint} style={styles.input} />
        </Cell>
        <Cell label="Pieces">
          <TextInput value={value.pieces_per_unit} onChangeText={set('pieces_per_unit')} keyboardType="number-pad" style={styles.input} />
        </Cell>
        <Cell label="Price ₹">
          <TextInput value={value.price} onChangeText={set('price')} keyboardType="decimal-pad" style={styles.input} />
        </Cell>
      </View>
      <View style={styles.row}>
        <Cell label="Min qty">
          <TextInput value={value.min_qty} onChangeText={set('min_qty')} keyboardType="number-pad" style={styles.input} />
        </Cell>
        <Cell label="Step">
          <TextInput value={value.step_qty} onChangeText={set('step_qty')} keyboardType="number-pad" style={styles.input} />
        </Cell>
        <Cell label="Max (opt.)">
          <TextInput value={value.max_qty} onChangeText={set('max_qty')} keyboardType="number-pad" style={styles.input} />
        </Cell>
      </View>
      <View style={styles.bottom}>
        <Pressable onPress={onMakeDefault} style={styles.defaultRow}>
          <Switch value={value.is_default} onValueChange={onMakeDefault} />
          <Text style={styles.small}>Shown first{perPiece}</Text>
        </Pressable>
        {footer}
      </View>
    </View>
  );
}

function Cell({ label, flex = 1, children }: { label: string; flex?: number; children: React.ReactNode }) {
  return (
    <View style={{ flex }}>
      <Text style={styles.cellLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, backgroundColor: colors.card, marginBottom: space.md, gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  cellLabel: { fontSize: 11, color: colors.muted, marginBottom: 2, fontWeight: '600' },
  input: { minHeight: 40, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, fontSize: 15, color: colors.text },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  defaultRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 },
  small: { fontSize: 12, color: colors.muted, flexShrink: 1 },
});
