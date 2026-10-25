import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BannerCarousel } from '@/components/shop/BannerCarousel';
import { Banner as Notice, Button, Card, Empty, ErrorView, Field, SectionTitle, SkeletonList } from '@/components/ui';
import { api, errorText, uploadImage } from '@/lib/api';
import { mediaUrl } from '@/lib/format';
import { useCategoriesFlat, useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { Banner } from '@/lib/types';

const COLORS = ['#1F6FEB', '#1A7F37', '#B76E00', '#CF222E', '#8250DF', '#0E7490', '#BE185D', '#1F2328'];

/** Owner/staff: the offer banners shops see at the top of their home screen. */
export default function BannersScreen() {
  const { tenantId, base } = useManage();
  const qc = useQueryClient();
  const banners = useQuery({ queryKey: ['mbanners', tenantId], queryFn: () => api<Banner[]>(`${base}/banners`), enabled: !!tenantId });
  const categories = useCategoriesFlat(tenantId);
  const [editing, setEditing] = useState<Banner | 'new' | null>(null);
  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name;

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['mbanners'] }), qc.invalidateQueries({ queryKey: ['banners'] })]);

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => refresh(),
    onError: (err) => Alert.alert("Couldn't save", errorText(err)),
  });

  async function addPhoto() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [2, 1] });
    if (picked.canceled) return;
    const a = picked.assets[0];
    act.mutate(async () => {
      const created = await uploadImage<Banner>(`${base}/banners/photo`, { uri: a.uri, name: a.fileName, mimeType: a.mimeType });
      setEditing(created);
    });
  }

  function move(list: Banner[], from: number, to: number) {
    const ids = list.map((b) => b.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    act.mutate(() => api(`${base}/banners-order`, { method: 'PUT', body: { ids } }));
  }

  if (banners.isLoading) return <SkeletonList count={3} />;
  if (banners.isError) return <ErrorView message={errorText(banners.error)} onRetry={() => banners.refetch()} />;
  const list = banners.data ?? [];
  const active = list.filter((b) => b.is_active);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingVertical: space.lg, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={banners.isRefetching} onRefresh={() => void banners.refetch()} />}>
        <Text style={[styles.help, { paddingHorizontal: space.lg }]}>
          Banners slide at the top of every shop&apos;s home screen. Use a designed photo (best 2:1, e.g. 1400 × 700), or just a
          title on a colour.
        </Text>

        {active.length > 0 && (
          <>
            <Text style={styles.previewLabel}>PREVIEW · what shops see</Text>
            <BannerCarousel banners={active} onOpen={() => undefined} />
          </>
        )}

        <View style={{ paddingHorizontal: space.lg }}>
          <View style={styles.addRow}>
            <Button title="Photo banner" icon="image-outline" onPress={addPhoto} loading={act.isPending && editing === null} style={{ flex: 1 }} />
            <Button title="Text banner" icon="text-outline" variant="secondary" onPress={() => setEditing('new')} style={{ flex: 1 }} />
          </View>

          <SectionTitle>Your banners ({list.length})</SectionTitle>
          {list.length === 0 ? (
            <Empty icon="images-outline" title="No banners yet" text="Add an offer, new stock or a festival greeting." />
          ) : (
            <Card style={{ paddingVertical: space.xs }}>
              {list.map((b, i) => (
                <View key={b.id} style={[styles.row, i > 0 && styles.border]}>
                  <Pressable onPress={() => setEditing(b)} style={styles.thumb}>
                    {b.image_url ? (
                      <Image source={{ uri: mediaUrl(b.image_url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, styles.thumbText, { backgroundColor: b.color ?? colors.primary }]}>
                        <Text style={styles.thumbTitle} numberOfLines={2}>
                          {b.title}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                  <Pressable onPress={() => setEditing(b)} style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {b.title ?? 'Photo banner'}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {b.link_category_id ? `Opens ${catName(b.link_category_id) ?? 'a category'}` : 'No link'}
                      {b.is_active ? '' : ' · hidden'}
                    </Text>
                  </Pressable>
                  <View style={styles.arrows}>
                    <Pressable disabled={i === 0 || act.isPending} onPress={() => move(list, i, i - 1)} hitSlop={6} accessibilityLabel="Move up">
                      <Ionicons name="chevron-up" size={20} color={i === 0 ? colors.border : colors.muted} />
                    </Pressable>
                    <Pressable disabled={i === list.length - 1 || act.isPending} onPress={() => move(list, i, i + 1)} hitSlop={6} accessibilityLabel="Move down">
                      <Ionicons name="chevron-down" size={20} color={i === list.length - 1 ? colors.border : colors.muted} />
                    </Pressable>
                  </View>
                  <Switch
                    value={b.is_active}
                    onValueChange={(v) => act.mutate(() => api(`${base}/banners/${b.id}`, { method: 'PUT', body: { is_active: v } }))}
                  />
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      <Modal visible={editing !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditing(null)}>
        {editing !== null && (
          <Editor
            key={editing === 'new' ? 'new' : editing.id}
            banner={editing === 'new' ? null : editing}
            base={base}
            categories={(categories.data ?? []).map((c) => ({ id: c.id, name: c.name, sub: !!c.parent_id }))}
            onClose={async (changed) => {
              setEditing(null);
              if (changed) await refresh();
            }}
          />
        )}
      </Modal>
    </View>
  );
}

function Editor({
  banner,
  base,
  categories,
  onClose,
}: {
  banner: Banner | null;
  base: string;
  categories: { id: string; name: string; sub: boolean }[];
  onClose: (changed: boolean) => void;
}) {
  const [title, setTitle] = useState(banner?.title ?? '');
  const [subtitle, setSubtitle] = useState(banner?.subtitle ?? '');
  const [color, setColor] = useState(banner?.color ?? COLORS[0]);
  const [link, setLink] = useState<string | null>(banner?.link_category_id ?? null);
  const [active, setActive] = useState(banner?.is_active ?? true);
  const [image, setImage] = useState(banner?.image_url ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview: Banner = {
    id: 'preview',
    title: title.trim() || null,
    subtitle: subtitle.trim() || null,
    image_url: image,
    color,
    link_category_id: link,
    is_active: true,
    sort_order: 0,
  };

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const body = { title: title.trim() || null, subtitle: subtitle.trim() || null, color, link_category_id: link, is_active: active };
      if (banner) await api(`${base}/banners/${banner.id}`, { method: 'PUT', body });
      else await api(`${base}/banners`, { method: 'POST', body });
      onClose(true);
    });

  const changePhoto = () =>
    run(async () => {
      if (!banner) return;
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [2, 1] });
      if (picked.canceled) return;
      const a = picked.assets[0];
      const updated = await uploadImage<Banner>(`${base}/banners/${banner.id}/image`, { uri: a.uri, name: a.fileName, mimeType: a.mimeType });
      setImage(updated.image_url);
    });

  const removePhoto = () =>
    run(async () => {
      if (!banner) return;
      const updated = await api<Banner>(`${base}/banners/${banner.id}/image`, { method: 'DELETE' });
      setImage(updated.image_url);
    });

  const remove = () =>
    Alert.alert('Delete this banner?', 'Shops will stop seeing it.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(async () => {
        await api(`${base}/banners/${banner!.id}`, { method: 'DELETE' });
        onClose(true);
      }) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View style={styles.sheetHead}>
        <Pressable onPress={() => onClose(false)} hitSlop={10}>
          <Text style={styles.sheetCancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.sheetTitle}>{banner ? 'Edit banner' : 'New text banner'}</Text>
        <View style={{ width: 52 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingVertical: space.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.previewLabel}>PREVIEW</Text>
        {preview.title || preview.image_url ? (
          <BannerCarousel banners={[preview]} onOpen={() => undefined} />
        ) : (
          <Text style={[styles.help, { paddingHorizontal: space.lg }]}>Type a title to see the banner.</Text>
        )}

        <View style={{ padding: space.lg }}>
          {banner && (
            <View style={styles.addRow}>
              <Button title={image ? 'Change photo' : 'Add photo'} icon="image-outline" variant="secondary" onPress={changePhoto} style={{ flex: 1 }} />
              {image && banner.title ? (
                <Button title="Remove photo" variant="ghost" onPress={removePhoto} style={{ flex: 1 }} />
              ) : null}
            </View>
          )}

          <Field label={image ? 'Title (optional, for your list)' : 'Title'} value={title} onChangeText={setTitle} maxLength={80} placeholder="e.g. Diwali offer on sugar" />
          {!image && (
            <>
              <Field label="Subtitle (optional)" value={subtitle} onChangeText={setSubtitle} maxLength={140} placeholder="e.g. 5% off on 50 kg bags this week" />
              <Text style={styles.label}>Colour</Text>
              <View style={styles.swatches}>
                {COLORS.map((c) => (
                  <Pressable key={c} onPress={() => setColor(c)} style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]} accessibilityLabel={`Colour ${c}`}>
                    {color === c && <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>When a shop taps it, open</Text>
          <View style={styles.chips}>
            <Chip label="Nothing" active={link === null} onPress={() => setLink(null)} />
            {categories.map((c) => (
              <Chip key={c.id} label={c.sub ? `› ${c.name}` : c.name} active={link === c.id} onPress={() => setLink(c.id)} />
            ))}
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>Show to shops</Text>
              <Text style={styles.meta}>Turn off to hide it without deleting</Text>
            </View>
            <Switch value={active} onValueChange={setActive} />
          </View>

          {error && <Notice kind="error" text={error} />}
          <Button title="Save banner" onPress={save} loading={busy} disabled={!title.trim() && !image} />
          {banner && <Button title="Delete banner" variant="danger" onPress={remove} style={{ marginTop: space.md }} />}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && { color: '#FFFFFF' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: space.md },
  previewLabel: { fontSize: 11, fontWeight: '800', color: colors.faint, letterSpacing: 0.6, paddingHorizontal: space.lg, marginBottom: space.sm },
  addRow: { flexDirection: 'row', gap: space.md, marginTop: space.lg, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  thumb: { width: 84, height: 42, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border },
  thumbText: { padding: 4, justifyContent: 'center' },
  thumbTitle: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  arrows: { alignItems: 'center' },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetCancel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: space.sm },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: space.md },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, elevation: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: space.lg },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg, backgroundColor: colors.card, padding: space.md, borderRadius: radius.md },
});
