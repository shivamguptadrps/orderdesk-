import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, space } from '@/lib/theme';
import type { FlatCategory } from '@/lib/types';

/** Tap to open the category tree, tap a category to choose it. */
export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: FlatCategory[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(!value);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path = (id: string | null): string[] => {
    const c = id ? byId.get(id) : undefined;
    return c ? [...path(c.parent_id), c.name] : [];
  };
  const depth = (c: FlatCategory): number => (c.parent_id ? 1 + depth(byId.get(c.parent_id)!) : 0);

  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.label}>Category</Text>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.box}>
        <Text style={[styles.value, !value && { color: colors.faint }]}>{value ? path(value).join(' › ') : 'Choose a category'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {open && (
        <View style={styles.list}>
          {categories.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => {
                onChange(c.id);
                setOpen(false);
              }}
              style={[styles.item, { paddingLeft: space.md + depth(c) * 18 }, c.id === value && styles.itemActive]}>
              <Text style={[styles.itemText, depth(c) === 0 && { fontWeight: '700' }]}>{c.name}</Text>
              {c.id === value && <Ionicons name="checkmark" size={18} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  box: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  value: { fontSize: 16, color: colors.text, flex: 1 },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, marginTop: 6, backgroundColor: colors.card, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingRight: space.md },
  itemActive: { backgroundColor: colors.primarySoft },
  itemText: { fontSize: 15, color: colors.text },
});
