import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { CategoryPicker } from '@/components/manage/CategoryPicker';
import { FeaturesEditor, featuresForApi, featuresFromApi, type FeatureValues } from '@/components/manage/FeaturesEditor';
import { PhotosSection } from '@/components/manage/PhotosSection';
import { StockSection } from '@/components/manage/StockSection';
import { emptyUnit, UnitForm, unitForApi, type UnitDraft } from '@/components/manage/UnitForm';
import { Banner, Button, Card, ErrorView, Field, Loading, SectionTitle } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useCategoriesFlat, useManage, useRefreshManage } from '@/lib/manage';
import { colors, space } from '@/lib/theme';
import type { Attribute, FlatCategory, ManageProduct, ManageUnit } from '@/lib/types';

export default function ProductEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tenantId, base } = useManage();
  const isNew = id === 'new';
  const categories = useCategoriesFlat(tenantId);
  const product = useQuery({
    queryKey: ['mproduct', id],
    queryFn: () => api<ManageProduct>(`${base}/products/${id}`),
    enabled: !!tenantId && !isNew,
  });

  if (!tenantId || categories.isLoading || (!isNew && product.isLoading)) return <Loading />;
  if (categories.isError) return <ErrorView message={errorText(categories.error)} onRetry={() => categories.refetch()} />;
  if (!isNew && product.isError) return <ErrorView message={errorText(product.error)} onRetry={() => product.refetch()} />;

  return (
    <>
      <Stack.Screen options={{ title: isNew ? 'New product' : 'Edit product' }} />
      <Editor
        key={isNew ? 'new' : product.data!.id}
        base={base}
        tenantId={tenantId}
        categories={categories.data!}
        product={isNew ? null : product.data!}
        reload={() => void product.refetch()}
      />
    </>
  );
}

const toDraft = (u: ManageUnit): UnitDraft => ({
  id: u.id,
  name: u.name,
  pieces_per_unit: String(u.pieces_per_unit),
  price: String(u.price),
  min_qty: String(u.min_qty),
  step_qty: String(u.step_qty),
  max_qty: u.max_qty === null ? '' : String(u.max_qty),
  is_default: u.is_default,
});

function Editor({
  base,
  tenantId,
  categories,
  product,
  reload,
}: {
  base: string;
  tenantId: string;
  categories: FlatCategory[];
  product: ManageProduct | null;
  reload: () => void;
}) {
  const router = useRouter();
  const refreshAll = useRefreshManage();
  const [form, setForm] = useState({
    category_id: product?.category_id ?? null,
    name: product?.name ?? '',
    brand: product?.brand ?? '',
    search_aliases: product?.search_aliases ?? '',
    sku: product?.sku ?? '',
    mrp: product?.mrp != null ? String(product.mrp) : '',
    description: product?.description ?? '',
    active: (product?.status ?? 'active') === 'active',
  });
  const [features, setFeatures] = useState<FeatureValues>(featuresFromApi(product?.attributes ?? {}));
  const [units, setUnits] = useState<UnitDraft[]>([emptyUnit(true)]); // new products only
  const [opening, setOpening] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string | boolean | null) => setForm((f) => ({ ...f, [key]: value }));

  const attrs = useQuery({
    queryKey: ['mattrs', tenantId, form.category_id],
    queryFn: () => api<Attribute[]>(`${base}/categories/${form.category_id}/attributes`),
    enabled: !!form.category_id,
  });

  function baseBody() {
    const mrp = form.mrp.trim() ? Number(form.mrp.replace(/[₹,\s]/g, '')) : null;
    return {
      category_id: form.category_id,
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      search_aliases: form.search_aliases.trim() || null,
      sku: form.sku.trim() || null,
      mrp: mrp !== null && Number.isFinite(mrp) ? mrp : null,
      description: form.description.trim() || null,
      status: form.active ? 'active' : 'hidden',
      attributes: featuresForApi(attrs.data ?? [], features),
    };
  }

  async function save() {
    setError(null);
    setSavedNote(null);
    if (!form.category_id) return setError('Choose a category');
    if (!form.name.trim()) return setError('Enter the product name');
    if (!attrs.data) return setError('Features are still loading. Try again in a moment.');
    setSaving(true);
    try {
      if (!product) {
        const bodies = units.map(unitForApi);
        const bad = bodies.find((b) => b.error);
        if (bad) throw new Error(bad.error);
        const created = await api<ManageProduct>(`${base}/products`, {
          method: 'POST',
          body: { ...baseBody(), units: bodies.map((b) => b.body), opening_stock_pieces: Number(opening || '0') },
        });
        await refreshAll();
        router.replace({ pathname: '/manage/product/[id]', params: { id: created.id } });
        Alert.alert('Product saved', 'Now add photos so shops can see it.');
      } else {
        await api<ManageProduct>(`${base}/products/${product.id}`, { method: 'PUT', body: baseBody() });
        await refreshAll();
        setSavedNote('Saved');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  function deleteProduct() {
    Alert.alert('Delete this product?', 'This cannot be undone. To stop selling it for now, switch off "On sale" instead.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`${base}/products/${product!.id}`, { method: 'DELETE' });
            await refreshAll();
            router.back();
          } catch (err) {
            Alert.alert("Couldn't delete", errorText(err));
          }
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        {product && (
          <>
            <SectionTitle>Photos</SectionTitle>
            <PhotosSection product={product} base={base} onChanged={reload} />
          </>
        )}

        <SectionTitle>Basic details</SectionTitle>
        <CategoryPicker
          categories={categories}
          value={form.category_id}
          onChange={(id) => {
            set('category_id')(id);
            setFeatures({});
          }}
        />
        <Field label="Product name *" value={form.name} onChangeText={set('name')} placeholder="e.g. Mithas Sugar 1 kg" />
        <Field label="Brand" value={form.brand} onChangeText={set('brand')} />
        <Field
          label="Search words"
          value={form.search_aliases}
          onChangeText={set('search_aliases')}
          placeholder="cheeni, chini, शक्कर"
          hint="Other names shops may type: Hindi, Hinglish, local words. Separate with commas."
        />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="MRP per piece ₹" value={form.mrp} onChangeText={set('mrp')} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="SKU / code" value={form.sku} onChangeText={set('sku')} autoCapitalize="characters" />
          </View>
        </View>
        <Field label="Description" value={form.description} onChangeText={set('description')} multiline />
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>On sale</Text>
            <Text style={styles.small}>Off = hidden from shops (keeps history)</Text>
          </View>
          <Switch value={form.active} onValueChange={set('active')} />
        </View>

        {form.category_id && (
          <>
            <SectionTitle>Features</SectionTitle>
            {attrs.isLoading ? <Loading /> : <FeaturesEditor attributes={attrs.data ?? []} values={features} onChange={setFeatures} />}
          </>
        )}

        {error && <Banner kind="error" text={error} />}
        {savedNote && <Banner kind="ok" text={savedNote} />}
        {product && <Button title="Save details" onPress={save} loading={saving} />}

        <SectionTitle>Pack sizes</SectionTitle>
        <Text style={[styles.small, { marginBottom: space.sm }]}>
          Stock is counted in pieces. A pack is &quot;N pieces at price P&quot; (Piece = 1, Box = 12, Carton = 24).
        </Text>
        {product ? (
          <ExistingUnits
            key={product.units.map((u) => `${u.id}:${u.price}:${u.pieces_per_unit}:${u.is_default}:${u.min_qty}:${u.step_qty}:${u.max_qty}`).join('|')}
            product={product}
            base={base}
            onChanged={async () => {
              await refreshAll();
              reload();
            }}
          />
        ) : (
          <>
            {units.map((u, i) => (
              <UnitForm
                key={`new-${i}`}
                value={u}
                onChange={(next) => setUnits((us) => us.map((x, j) => (j === i ? next : x)))}
                onMakeDefault={() => setUnits((us) => us.map((x, j) => ({ ...x, is_default: j === i })))}
                footer={
                  units.length > 1 ? (
                    <Button title="Remove" variant="ghost" onPress={() => setUnits((us) => us.filter((_, j) => j !== i))} style={styles.smallBtn} />
                  ) : null
                }
              />
            ))}
            <Button title="Add pack size" icon="add" variant="ghost" onPress={() => setUnits((us) => [...us, emptyUnit(false)])} />
          </>
        )}

        {!product ? (
          <>
            <SectionTitle>Opening stock</SectionTitle>
            <Field label="Pieces in stock now" value={opening} onChangeText={(t) => setOpening(t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="0" />
            {error && <Banner kind="error" text={error} />}
            <Button title="Save product" onPress={save} loading={saving} />
          </>
        ) : (
          <>
            <SectionTitle>Stock</SectionTitle>
            <Card>
              <StockSection product={product} base={base} onChanged={reload} />
            </Card>
            <Button title="Delete product" variant="danger" onPress={deleteProduct} style={{ marginTop: space.xl }} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  small: { fontSize: 12, color: colors.muted },
  smallBtn: { minHeight: 36, paddingHorizontal: space.md },
});


/** Pack sizes of a saved product: each one saves on its own. Re-created (fresh drafts) after every change. */
function ExistingUnits({ product, base, onChanged }: { product: ManageProduct; base: string; onChanged: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<UnitDraft[]>(product.units.map(toDraft));

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await onChanged();
    } catch (err) {
      Alert.alert("Couldn't save pack size", errorText(err));
    }
  }

  function save(i: number) {
    const draft = drafts[i];
    const { body, error } = unitForApi(draft);
    if (error) return Alert.alert('Check pack size', error);
    void run(() =>
      draft.id ? api(`${base}/units/${draft.id}`, { method: 'PUT', body }) : api(`${base}/products/${product.id}/units`, { method: 'POST', body }),
    );
  }

  function remove(i: number) {
    const draft = drafts[i];
    if (!draft.id) return setDrafts((ds) => ds.filter((_, j) => j !== i));
    Alert.alert(`Delete ${draft.name}?`, 'Shops will no longer be able to order this pack size.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run(() => api(`${base}/units/${draft.id}`, { method: 'DELETE' })) },
    ]);
  }

  function makeDefault(i: number) {
    const draft = drafts[i];
    if (draft.id) void run(() => api(`${base}/units/${draft.id}`, { method: 'PUT', body: { is_default: true } }));
    else setDrafts((ds) => ds.map((d, j) => ({ ...d, is_default: j === i })));
  }

  return (
    <View>
      {drafts.map((u, i) => (
        <UnitForm
          key={u.id ?? `new-${i}`}
          value={u}
          onChange={(next) => setDrafts((ds) => ds.map((d, j) => (j === i ? next : d)))}
          onMakeDefault={() => makeDefault(i)}
          footer={
            <View style={styles.row}>
              <Button title={u.id ? 'Save' : 'Add'} variant="secondary" onPress={() => save(i)} style={styles.smallBtn} />
              {(drafts.length > 1 || !u.id) && <Button title="Delete" variant="ghost" onPress={() => remove(i)} style={styles.smallBtn} />}
            </View>
          }
        />
      ))}
      <Button title="Add pack size" icon="add" variant="ghost" onPress={() => setDrafts((ds) => [...ds, emptyUnit(false)])} />
    </View>
  );
}
