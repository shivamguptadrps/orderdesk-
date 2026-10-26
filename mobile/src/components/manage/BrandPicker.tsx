import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, errorText } from '@/lib/api';
import { colors, radius, space } from '@/lib/theme';
import type { BrandInfo } from '@/lib/types';

export const brandKey = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
const spellings = (b: BrandInfo) => [b.name, ...(b.aliases ?? '').split(',')].map(brandKey).filter(Boolean);

export function useBrands(base: string, enabled = true) {
  return useQuery({ queryKey: ['mbrands', base], queryFn: () => api<BrandInfo[]>(`${base}/brands`), enabled });
}

/**
 * Brand field: pick from this distributor's brands (search matches other spellings too),
 * or add a new one. One brand = one name everywhere, so the shop's brand filter and search stay clean.
 */
export function BrandPicker({
  base,
  value,
  onChange,
}: {
  base: string;
  value: { id: string; name: string } | null;
  onChange: (brand: { id: string; name: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.label}>Brand</Text>
      <Pressable onPress={() => setOpen(true)} style={styles.field} accessibilityRole="button" accessibilityLabel={`Brand: ${value?.name ?? 'none'}`}>
        <Text style={[styles.value, !value && { color: colors.faint }]} numberOfLines={1}>
          {value?.name ?? 'Choose brand'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      {open && <BrandSheet base={base} selectedId={value?.id ?? null} onClose={() => setOpen(false)} onPick={(b) => (onChange(b), setOpen(false))} />}
    </View>
  );
}

function BrandSheet({
  base,
  selectedId,
  onPick,
  onClose,
}: {
  base: string;
  selectedId: string | null;
  onPick: (b: { id: string; name: string } | null) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const brands = useBrands(base);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const key = brandKey(q);
  const list = (brands.data ?? []).filter((b) => !key || spellings(b).some((s) => s.includes(key)));
  const exact = (brands.data ?? []).find((b) => spellings(b).includes(key));

  async function add() {
    setAdding(true);
    try {
      const b = await api<BrandInfo>(`${base}/brands`, { method: 'POST', body: { name: q.trim() } });
      await qc.invalidateQueries({ queryKey: ['mbrands'] });
      onPick({ id: b.id, name: b.name });
    } catch (err) {
      Alert.alert("Couldn't add the brand", errorText(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Brand</Text>
          <Pressable onPress={() => onPick(null)} hitSlop={10}>
            <Text style={[styles.cancel, { color: colors.muted }]}>None</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search or type a new brand" placeholderTextColor={colors.faint} style={styles.searchInput} autoFocus />
          </View>
          {q.trim() && !exact ? (
            <Pressable onPress={add} disabled={adding} style={styles.addRow}>
              {adding ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="add-circle" size={22} color={colors.primary} />}
              <Text style={styles.addText}>Add new brand “{q.trim()}”</Text>
            </Pressable>
          ) : null}
          {brands.isLoading ? (
            <ActivityIndicator style={{ margin: space.xl }} color={colors.primary} />
          ) : (
            <FlatList
              data={list}
              keyExtractor={(b) => b.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }}
              ListEmptyComponent={!q ? <Text style={styles.empty}>No brands yet. Type a name to add one.</Text> : undefined}
              renderItem={({ item, index }) => (
                <Pressable onPress={() => onPick({ id: item.id, name: item.name })} style={[styles.row, index > 0 && styles.border]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.product_count} product{item.product_count === 1 ? '' : 's'}
                      {item.aliases ? ` · also: ${item.aliases}` : ''}
                    </Text>
                  </View>
                  {item.id === selectedId && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                </Pressable>
              )}
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  field: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.md, backgroundColor: colors.card },
  value: { flex: 1, fontSize: 16, color: colors.text },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cancel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, margin: space.lg, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.card },
  searchInput: { flex: 1, minHeight: 46, fontSize: 16, color: colors.text },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, marginBottom: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  addText: { color: colors.primaryDark, fontWeight: '800', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: space.xl },
});
