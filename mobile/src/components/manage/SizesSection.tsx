import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { emptyUnit, UnitForm, unitForApi, type UnitDraft } from '@/components/manage/UnitForm';
import { Banner, Button, Field } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { inr } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';
import type { ManageProduct, Page } from '@/lib/types';

/** "5 kg" out of "India Gate Basmati 5 kg", to suggest a size label. */
export function guessSize(name: string): string {
  const m = /(\d+(?:\.\d+)?\s?(?:kg|g|gm|gms|l|ltr|litre|ml|pcs|pc|pieces))\b/i.exec(name);
  return m ? m[1] : '';
}

/**
 * Sizes of this product (Rice 1 kg / 5 kg / 10 kg). Shops see one card and pick a size;
 * each size is its own product underneath, with its own price, stock and photos.
 */
export function SizesSection({ product, base, onChanged }: { product: ManageProduct; base: string; onChanged: () => void | Promise<void> }) {
  const router = useRouter();
  const sizes = product.sizes ?? [];
  const [label, setLabel] = useState(product.variant_label ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const found = useQuery({
    queryKey: ['mproducts', 'size-pick', base, q],
    queryFn: () => api<Page<ManageProduct>>(`${base}/products`, { query: { q, limit: 6 } }),
    enabled: q.length >= 2,
  });
  const taken = new Set([product.id, ...sizes.map((s) => s.id)]);
  const results = (found.data?.items ?? []).filter((p) => !taken.has(p.id));

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      Alert.alert("Couldn't save", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const saveLabel = () => run('label', () => api(`${base}/products/${product.id}`, { method: 'PUT', body: { variant_label: label.trim() || null } }));
  const link = (otherId: string) =>
    run(`link-${otherId}`, async () => {
      await api(`${base}/products/${otherId}/size-group`, { method: 'PUT', body: { join_product_id: product.id } });
      setSearch('');
    });
  const leave = () =>
    Alert.alert('Remove from sizes?', `${product.name} becomes a separate product again. Nothing is deleted.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run('leave', () => api(`${base}/products/${product.id}/size-group`, { method: 'PUT', body: { join_product_id: null } })) },
    ]);

  return (
    <View>
      <Text style={styles.help}>
        Sell this in other sizes (1 kg, 5 kg…). Shops see one card and choose a size. Each size has its own price, stock and photos.
      </Text>

      <Text style={styles.label}>This product&apos;s size</Text>
      <View style={styles.labelRow}>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder={guessSize(product.name) || 'e.g. 1 kg'}
          placeholderTextColor={colors.faint}
          maxLength={40}
          style={styles.input}
        />
        <Button
          title="Save"
          variant="secondary"
          onPress={saveLabel}
          loading={busy === 'label'}
          disabled={label.trim() === (product.variant_label ?? '')}
          style={{ minHeight: 44, paddingHorizontal: space.lg }}
        />
      </View>

      {sizes.length > 0 && (
        <View style={{ marginTop: space.md }}>
          <Text style={styles.label}>Other sizes</Text>
          {sizes.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => router.push({ pathname: '/manage/product/[id]', params: { id: s.id } })}
              style={[styles.row, i > 0 && styles.border]}>
              <View style={styles.sizeBadge}>
                <Text style={styles.sizeBadgeText} numberOfLines={1}>
                  {s.label}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={styles.meta}>
                  {s.price != null ? inr(s.price) : 'No price'} · {s.stock_pieces} in stock{s.status === 'hidden' ? ' · not on sale' : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.faint} />
            </Pressable>
          ))}
        </View>
      )}

      <Button title="Add another size" icon="add-circle-outline" onPress={() => setAdding(true)} style={{ marginTop: space.md }} />

      <View style={styles.searchBox}>
        <Ionicons name="link-outline" size={18} color={colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Already added another size? Type its name to link"
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          autoCorrect={false}
        />
      </View>
      {q.length >= 2 &&
        (found.isLoading ? (
          <ActivityIndicator style={{ marginTop: space.sm }} color={colors.primary} />
        ) : results.length === 0 ? (
          <Text style={[styles.meta, { marginTop: space.sm }]}>No other product matches “{q}”.</Text>
        ) : (
          results.map((p) => (
            <Pressable key={p.id} disabled={!!busy} onPress={() => link(p.id)} style={[styles.row, styles.border]}>
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
                {p.name}
              </Text>
              {busy === `link-${p.id}` ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.linkText}>Link as size</Text>}
            </Pressable>
          ))
        ))}

      {sizes.length > 0 && (
        <Pressable onPress={leave} disabled={!!busy} style={{ marginTop: space.md }} hitSlop={6}>
          <Text style={styles.leave}>Remove this product from the sizes</Text>
        </Pressable>
      )}

      {adding && (
        <AddSizeModal
          product={product}
          base={base}
          onClose={async (createdId) => {
            setAdding(false);
            if (createdId) {
              await onChanged();
              router.push({ pathname: '/manage/product/[id]', params: { id: createdId } });
            }
          }}
        />
      )}
    </View>
  );
}

/** Make the next size: only what differs (size, name, price, stock); the rest is copied. */
function AddSizeModal({ product, base, onClose }: { product: ManageProduct; base: string; onClose: (createdId: string | null) => void }) {
  const current = product.variant_label || guessSize(product.name);
  const main = product.units.find((u) => u.is_default) ?? product.units[0];
  const [sourceLabel, setSourceLabel] = useState(current);
  const [label, setLabel] = useState('');
  const [name, setName] = useState(product.name);
  const [nameTouched, setNameTouched] = useState(false);
  const [sku, setSku] = useState('');
  const [mrp, setMrp] = useState('');
  const [unit, setUnit] = useState<UnitDraft>({ ...emptyUnit(true), name: main?.name ?? '', pieces_per_unit: String(main?.pieces_per_unit ?? 1) });
  const [stock, setStock] = useState('');
  const [photos, setPhotos] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onLabel(text: string) {
    setLabel(text);
    // Suggest "India Gate Basmati 5 kg" from "India Gate Basmati 1 kg" until the name is typed by hand.
    if (!nameTouched) {
      const old = product.variant_label || guessSize(product.name);
      setName(old && product.name.includes(old) ? product.name.replace(old, text.trim()) : `${product.name} ${text.trim()}`.trim());
    }
  }

  async function save() {
    setError(null);
    if (!label.trim()) return setError('Enter the new size, e.g. 5 kg');
    if (!name.trim()) return setError('Enter a name');
    const u = unitForApi(unit);
    if (u.error) return setError(u.error);
    const mrpNum = mrp.trim() ? Number(mrp.replace(/[₹,\s]/g, '')) : null;
    setSaving(true);
    try {
      const created = await api<ManageProduct>(`${base}/products/${product.id}/sizes`, {
        method: 'POST',
        body: {
          variant_label: label.trim(),
          source_label: product.variant_label ? null : sourceLabel.trim() || null,
          name: name.trim(),
          sku: sku.trim() || null,
          mrp: mrpNum !== null && Number.isFinite(mrpNum) ? mrpNum : null,
          units: [u.body],
          opening_stock_pieces: Number(stock || '0'),
          copy_photos: photos,
        },
      });
      onClose(created.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Pressable onPress={() => onClose(null)} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Add another size</Text>
          <View style={{ width: 52 }} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.help}>
              Category, brand, description, search words, features{photos ? ' and photos' : ''} are copied from {product.name}. You can change them after.
            </Text>
            {!product.variant_label && (
              <Field label={`Size of ${product.name}`} value={sourceLabel} onChangeText={setSourceLabel} placeholder="e.g. 1 kg" maxLength={40} />
            )}
            <Field label="New size *" value={label} onChangeText={onLabel} placeholder="e.g. 5 kg" maxLength={40} autoFocus />
            <Field
              label="Name of the new size *"
              value={name}
              onChangeText={(t) => {
                setName(t);
                setNameTouched(true);
              }}
              maxLength={200}
            />
            <Text style={styles.label}>Pack and price</Text>
            <UnitForm value={unit} onChange={setUnit} onMakeDefault={() => undefined} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Field label="MRP (optional)" value={mrp} onChangeText={setMrp} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Pieces in stock now" value={stock} onChangeText={(t) => setStock(t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="0" />
              </View>
            </View>
            <Field label="SKU (optional)" value={sku} onChangeText={setSku} maxLength={64} />
            <View style={styles.switchRow}>
              <Text style={[styles.name, { flex: 1 }]}>Copy the photos</Text>
              <Switch value={photos} onValueChange={setPhotos} />
            </View>
            {error && <Banner kind="error" text={error} />}
            <Button title="Add size" icon="checkmark" onPress={save} loading={saving} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: 13, color: colors.muted, marginBottom: space.md, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  labelRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.md, fontSize: 15, color: colors.text, backgroundColor: colors.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sizeBadge: { minWidth: 56, maxWidth: 90, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center' },
  sizeBadgeText: { fontSize: 13, fontWeight: '800', color: colors.primaryDark },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  leave: { color: colors.error, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, minHeight: 44, fontSize: 15, color: colors.text },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cancel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
});
