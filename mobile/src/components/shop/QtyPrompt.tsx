import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, firstQty } from '@/components/ui';
import { colors, radius, space } from '@/lib/theme';

type Rules = { min_qty: number; step_qty: number; max_qty: number | null };

/** Why a typed quantity isn't allowed, or null if it is. */
export function qtyError(qty: number, r: Rules): string | null {
  if (!Number.isInteger(qty) || qty < 1) return 'Enter a number like 5';
  if (qty < r.min_qty) return `Minimum is ${r.min_qty}`;
  if (qty % r.step_qty !== 0) return `Must be in multiples of ${r.step_qty} (e.g. ${Math.ceil(qty / r.step_qty) * r.step_qty})`;
  if (r.max_qty !== null && qty > r.max_qty) return `Maximum is ${r.max_qty}`;
  return null;
}

/** Ready-made amounts to tap: the first allowed quantity, then 2×, 5×, 10× of it (within the max). */
export function quickQtys(r: Rules): number[] {
  const first = firstQty(r.min_qty, r.step_qty);
  const out = [first, first * 2, first * 5, first * 10].filter((q) => r.max_qty === null || q <= r.max_qty);
  return [...new Set(out)];
}

/** A small pop-up to type how many packs you want. */
export function QtyPrompt({
  visible,
  title,
  unitLabel,
  initial,
  rules,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  unitLabel: string;
  initial: number;
  rules: Rules;
  onClose: () => void;
  onSave: (qty: number) => void;
}) {
  const [text, setText] = useState(String(initial));
  const qty = Number(text);
  const error = text ? qtyError(qty, rules) : 'Enter a quantity';
  const hint = [rules.min_qty > 1 ? `min ${rules.min_qty}` : null, rules.step_qty > 1 ? `multiples of ${rules.step_qty}` : null, rules.max_qty ? `max ${rules.max_qty}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={() => setText(String(initial))}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.sub}>
            How many {unitLabel}?{hint ? ` (${hint})` : ''}
          </Text>
          <TextInput
            value={text}
            onChangeText={(t) => setText(t.replace(/\D/g, '').slice(0, 5))}
            keyboardType="number-pad"
            autoFocus
            selectTextOnFocus
            style={[styles.input, text && error ? { borderColor: colors.error } : null]}
            accessibilityLabel="Quantity"
            onSubmitEditing={() => !error && onSave(qty)}
          />
          <Text style={[styles.error, !(text && error) && { opacity: 0 }]}>{error ?? ' '}</Text>
          <View style={styles.quick}>
            {quickQtys(rules).map((q) => (
              <Pressable key={q} onPress={() => setText(String(q))} style={[styles.chip, qty === q && styles.chipOn]}>
                <Text style={[styles.chipText, qty === q && { color: '#FFFFFF' }]}>{q}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Set quantity" onPress={() => onSave(qty)} disabled={!!error} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: space.xl },
  sheet: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.xl },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  sub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  input: {
    marginTop: space.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.md,
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
    paddingVertical: space.sm,
    color: colors.text,
  },
  error: { color: colors.error, fontSize: 13, marginTop: 6, minHeight: 18 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 15, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
});
