import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useToast } from '@/components/Toast';
import { FeatureEditor } from '@/components/manage/FeatureEditor';
import { cardStyle, IconBubble, SectionHeader } from '@/components/manage/kit';
import { NameModal } from '@/components/manage/NameModal';
import { categoryLook } from '@/components/shop/categoryLook';
import { Banner, Button, Empty, ErrorView, Loading } from '@/components/ui';
import { api, errorText, uploadImage } from '@/lib/api';
import { feedback } from '@/lib/feedback';
import { mediaUrl } from '@/lib/format';
import { useCategoriesFlat, useManage, useRefreshManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { Attribute, FlatCategory } from '@/lib/types';

const MAX_DEPTH = 3;
const TYPE_LABEL: Record<Attribute['type'], string> = { select: 'Choice list', number: 'Number', text: 'Text', boolean: 'Yes / No' };
const TYPE_ICON: Record<Attribute['type'], keyof typeof Ionicons.glyphMap> = { select: 'list', number: 'calculator', text: 'text', boolean: 'toggle' };

/** One category: name, photo, sub-categories and the product features it asks for. */
export default function CategoryScreen() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const { tenantId, base } = useManage();
  const router = useRouter();
  const refresh = useRefreshManage();
  const cats = useCategoriesFlat(tenantId);
  const [renaming, setRenaming] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [editing, setEditing] = useState<Attribute | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  if (cats.isLoading) return <Loading />;
  if (cats.isError) return <ErrorView message={errorText(cats.error)} onRetry={() => cats.refetch()} />;
  const all = cats.data ?? [];
  const cat = all.find((c) => c.id === id);
  if (!cat) return <Empty icon="folder-open-outline" title="Category not found" text="It may have been deleted." />;

  const byId = new Map(all.map((c) => [c.id, c]));
  const chain: FlatCategory[] = [];
  for (let c: FlatCategory | undefined = cat; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) chain.unshift(c);
  const inherited = chain.slice(0, -1).flatMap((p) => p.attributes.map((a) => ({ ...a, from: p.name })));
  const children = all.filter((c) => c.parent_id === cat.id);
  const topIndex = all.filter((c) => !c.parent_id).findIndex((c) => c.id === chain[0].id);
  const look = categoryLook(chain[0].name, topIndex);
  const canHaveSubs = chain.length < MAX_DEPTH;

  async function run(fn: () => Promise<void>, done?: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (done) {
        feedback.success();
        useToast.getState().show({ text: done });
      }
    } catch (err) {
      feedback.error();
      Alert.alert("Couldn't save", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (picked.canceled) return;
    await run(() => uploadImage(`${base}/categories/${cat!.id}/image`, picked.assets[0]).then(() => undefined), 'Photo updated');
  }

  function removeFeature(a: Attribute) {
    Alert.alert(`Delete “${a.label}”?`, `Products in ${cat!.name} lose this detail. Their other details stay.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => api(`${base}/attributes/${a.id}`, { method: 'DELETE' }), 'Feature deleted') },
    ]);
  }

  function removeCategory() {
    Alert.alert(`Delete ${cat!.name}?`, 'Only empty categories can be deleted (no products, no sub-categories).', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          run(async () => {
            await api(`${base}/categories/${cat!.id}`, { method: 'DELETE' });
            router.back();
          }, 'Category deleted'),
      },
    ]);
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: cat.name }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={cats.isRefetching} onRefresh={() => void cats.refetch()} />}>
        {fresh === '1' && <Banner kind="ok" text={`${cat.name} is added. Add a photo and the features its products should have.`} />}

        <View style={[cardStyle, styles.hero]}>
          <Pressable onPress={pickPhoto} disabled={busy} style={[styles.photo, { backgroundColor: look.bg }]} accessibilityLabel="Change photo">
            {cat.image_url ? (
              <Image source={{ uri: mediaUrl(cat.image_url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Ionicons name={look.icon} size={34} color={look.fg} />
            )}
            <View style={styles.camera}>
              <Ionicons name="camera" size={14} color="#FFFFFF" />
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            {chain.length > 1 && <Text style={styles.path}>{chain.slice(0, -1).map((c) => c.name).join(' › ')}</Text>}
            <Text style={styles.name}>{cat.name}</Text>
            <Text style={styles.meta}>
              {cat.product_count ?? 0} product{cat.product_count === 1 ? '' : 's'} directly here
            </Text>
            <View style={styles.heroActions}>
              <Pressable onPress={() => setRenaming(true)} hitSlop={6}>
                <Text style={styles.link}>Rename</Text>
              </Pressable>
              {cat.image_url ? (
                <Pressable
                  onPress={() => run(() => api(`${base}/categories/${cat.id}/image`, { method: 'DELETE' }), 'Photo removed')}
                  hitSlop={6}>
                  <Text style={[styles.link, { color: colors.muted }]}>Remove photo</Text>
                </Pressable>
              ) : (
                <Pressable onPress={pickPhoto} hitSlop={6}>
                  <Text style={styles.link}>Add photo</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
        <Text style={styles.small}>The photo shows on the shops&apos; home screen instead of the icon. Square photos look best.</Text>

        <SectionHeader title="Product features" />
        <Text style={styles.small}>Every product in {cat.name} asks for these details. Shops can filter by the ones marked “Filter”.</Text>
        <View style={{ gap: space.sm, marginTop: space.md }}>
          {inherited.map((a) => (
            <View key={a.id} style={[cardStyle, styles.feature, { opacity: 0.75 }]}>
              <IconBubble icon={TYPE_ICON[a.type]} tone="grey" size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.featureName}>{a.label}</Text>
                <Text style={styles.featureMeta}>From {a.from} · edit it there</Text>
              </View>
              <Ionicons name="lock-closed" size={14} color={colors.faint} />
            </View>
          ))}
          {cat.attributes.map((a) => (
            <Pressable key={a.id} onPress={() => setEditing(a)} style={[cardStyle, styles.feature]}>
              <IconBubble icon={TYPE_ICON[a.type]} tone="blue" size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.featureName}>
                  {a.label}
                  {a.unit ? <Text style={styles.featureMeta}> ({a.unit})</Text> : null}
                </Text>
                <Text style={styles.featureMeta} numberOfLines={1}>
                  {TYPE_LABEL[a.type]}
                  {a.type === 'select' ? ` · ${a.options.join(', ')}` : ''}
                </Text>
                <View style={styles.badges}>
                  {a.is_filter && <Text style={[styles.badge, { backgroundColor: colors.primarySoft, color: colors.primaryDark }]}>Filter</Text>}
                  {a.required && <Text style={[styles.badge, { backgroundColor: colors.warnSoft, color: colors.warn }]}>Required</Text>}
                </View>
              </View>
              <Pressable onPress={() => removeFeature(a)} hitSlop={10} accessibilityLabel={`Delete ${a.label}`}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </Pressable>
          ))}
          {!inherited.length && !cat.attributes.length && <Text style={styles.empty}>No features yet. Products here will only have name, brand and price.</Text>}
        </View>
        <Button title="Add feature" icon="add-circle-outline" variant="secondary" onPress={() => setEditing('new')} style={{ marginTop: space.md }} />

        {canHaveSubs && (
          <>
            <SectionHeader title="Sub-categories" />
            <View style={[cardStyle, { paddingHorizontal: space.lg }]}>
              {children.map((k, i) => (
                <Pressable key={k.id} onPress={() => router.push({ pathname: '/manage/category/[id]', params: { id: k.id } })} style={[styles.sub, i > 0 && styles.border]}>
                  <Text style={styles.subName}>{k.name}</Text>
                  <Text style={styles.featureMeta}>{k.product_count ?? 0} products</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.faint} />
                </Pressable>
              ))}
              <Pressable onPress={() => setAddingSub(true)} style={[styles.sub, children.length > 0 && styles.border]}>
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={[styles.subName, { color: colors.primary }]}>Add sub-category</Text>
              </Pressable>
            </View>
          </>
        )}

        <Button title="Delete category" variant="danger" onPress={removeCategory} style={{ marginTop: space.xl }} disabled={busy} />
        <Text style={[styles.small, { textAlign: 'center', marginTop: space.sm }]}>Only possible when it has no products and no sub-categories.</Text>
      </ScrollView>

      {renaming && (
        <NameModal
          title="Rename category"
          initial={cat.name}
          onClose={() => setRenaming(false)}
          onSave={async (name) => {
            try {
              await api(`${base}/categories/${cat.id}`, { method: 'PUT', body: { name } });
              await refresh();
              setRenaming(false);
              useToast.getState().show({ text: 'Renamed' });
              return null;
            } catch (err) {
              return errorText(err);
            }
          }}
        />
      )}
      {addingSub && (
        <NameModal
          title={`New sub-category in ${cat.name}`}
          hint={`It gets ${cat.name}'s features too.`}
          placeholder="Sub-category name"
          saveLabel="Add"
          onClose={() => setAddingSub(false)}
          onSave={async (name) => {
            try {
              await api(`${base}/categories`, { method: 'POST', body: { name, parent_id: cat.id } });
              await refresh();
              setAddingSub(false);
              useToast.getState().show({ text: `${name} added` });
              return null;
            } catch (err) {
              return errorText(err);
            }
          }}
        />
      )}
      {editing && (
        <FeatureEditor
          base={base}
          categoryId={cat.id}
          categoryName={cat.name}
          feature={editing === 'new' ? null : editing}
          onClose={async (changed) => {
            setEditing(null);
            if (changed) {
              await refresh();
              feedback.success();
              useToast.getState().show({ text: 'Feature saved' });
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: space.lg, padding: space.lg, alignItems: 'center' },
  photo: { width: 84, height: 84, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  camera: { position: 'absolute', right: 4, bottom: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  path: { fontSize: 12, color: colors.muted },
  name: { fontSize: 20, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  heroActions: { flexDirection: 'row', gap: space.lg, marginTop: space.sm },
  link: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  small: { fontSize: 12, color: colors.muted, marginTop: space.sm, lineHeight: 17 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  featureName: { fontSize: 15, fontWeight: '700', color: colors.text },
  featureMeta: { fontSize: 12, color: colors.muted, fontWeight: '400' },
  badges: { flexDirection: 'row', gap: 6, marginTop: 4 },
  badge: { fontSize: 11, fontWeight: '800', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  empty: { fontSize: 13, color: colors.muted, padding: space.md },
  sub: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  subName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
