import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/Toast';
import { useBrands } from '@/components/manage/BrandPicker';
import { cardStyle } from '@/components/manage/kit';
import { Banner, Button, Empty, ErrorView, Field, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useManage, useRefreshManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { BrandInfo } from '@/lib/types';

/** Owner/staff: the brand list. One clean name per brand, other spellings for search, merge duplicates. */
export default function BrandsScreen() {
  const { base } = useManage();
  const qc = useQueryClient();
  const brands = useBrands(base);
  const [editing, setEditing] = useState<BrandInfo | 'new' | null>(null);
  const [merging, setMerging] = useState<BrandInfo | null>(null);

  if (brands.isLoading) return <SkeletonList count={6} />;
  if (brands.isError) return <ErrorView message={errorText(brands.error)} onRetry={() => brands.refetch()} />;
  const list = brands.data ?? [];

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 110, gap: space.sm }}
        refreshControl={<RefreshControl refreshing={brands.isRefetching} onRefresh={() => void brands.refetch()} />}
        ListHeaderComponent={
          <Text style={styles.help}>
            Each brand has one name that shops see and filter by. Add other spellings (Hindi, short names) so search finds it, e.g. Pansari: पंसारी,
            pansari group. Two brands that are really one? Merge them.
          </Text>
        }
        ListEmptyComponent={<Empty icon="pricetags-outline" title="No brands yet" text="Brands are added when you pick or type one on a product, or here." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => setEditing(item)} style={[cardStyle, styles.row]}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {item.product_count} product{item.product_count === 1 ? '' : 's'}
                {item.aliases ? ` · also: ${item.aliases}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </Pressable>
        )}
      />
      <View style={styles.footer}>
        <Button title="Add brand" icon="add" onPress={() => setEditing('new')} />
      </View>
      {editing && (
        <BrandEditor
          base={base}
          brand={editing === 'new' ? null : editing}
          onMerge={(b) => {
            setEditing(null);
            setMerging(b);
          }}
          onClose={async (changed) => {
            setEditing(null);
            if (changed) await qc.invalidateQueries({ queryKey: ['mbrands'] });
          }}
        />
      )}
      {merging && (
        <MergeSheet
          base={base}
          source={merging}
          others={list.filter((b) => b.id !== merging.id)}
          onClose={async (changed) => {
            setMerging(null);
            if (changed) await qc.invalidateQueries({ queryKey: ['mbrands'] });
          }}
        />
      )}
    </View>
  );
}

function BrandEditor({ base, brand, onClose, onMerge }: { base: string; brand: BrandInfo | null; onClose: (changed: boolean) => void; onMerge: (b: BrandInfo) => void }) {
  const refresh = useRefreshManage();
  const [name, setName] = useState(brand?.name ?? '');
  const [aliases, setAliases] = useState(brand?.aliases ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), aliases: aliases.trim() || null };
      if (brand) await api(`${base}/brands/${brand.id}`, { method: 'PUT', body });
      else await api(`${base}/brands`, { method: 'POST', body });
      await refresh();
      useToast.getState().show({ text: brand ? 'Brand saved' : `${name.trim()} added` });
      onClose(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    Alert.alert(`Delete ${brand!.name}?`, 'Only brands with no products can be deleted.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`${base}/brands/${brand!.id}`, { method: 'DELETE' });
            onClose(true);
          } catch (err) {
            Alert.alert("Couldn't delete", errorText(err));
          }
        },
      },
    ]);
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Pressable onPress={() => onClose(false)} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>{brand ? 'Edit brand' : 'New brand'}</Text>
          <View style={{ width: 52 }} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ padding: space.lg }}>
            <Field label="Brand name *" value={name} onChangeText={setName} placeholder="e.g. Pansari" maxLength={100} />
            <Field
              label="Other spellings (for search)"
              value={aliases}
              onChangeText={setAliases}
              placeholder="पंसारी, pansari group"
              hint="Hindi name, short names, common misspellings. Separate with commas. Typing any of these on a product picks this brand."
              maxLength={1000}
            />
            {brand ? <Text style={styles.meta}>Renaming changes the brand on all its {brand.product_count} products.</Text> : null}
            {error && <Banner kind="error" text={error} />}
            <Button title="Save" icon="checkmark" onPress={save} loading={busy} disabled={!name.trim()} style={{ marginTop: space.md }} />
            {brand && (
              <View style={styles.actions}>
                <Button title="Merge into another brand" icon="git-merge-outline" variant="secondary" onPress={() => onMerge(brand)} />
                {brand.product_count === 0 && <Button title="Delete brand" variant="danger" onPress={remove} />}
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function MergeSheet({ base, source, others, onClose }: { base: string; source: BrandInfo; others: BrandInfo[]; onClose: (changed: boolean) => void }) {
  const refresh = useRefreshManage();
  function merge(into: BrandInfo) {
    Alert.alert(
      `Merge ${source.name} into ${into.name}?`,
      `${source.product_count} product${source.product_count === 1 ? '' : 's'} move to ${into.name}. “${source.name}” becomes another spelling of ${into.name}.`,
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'Merge',
          onPress: async () => {
            try {
              await api(`${base}/brands/${source.id}/merge`, { method: 'POST', body: { into_id: into.id } });
              await refresh();
              useToast.getState().show({ text: `Merged into ${into.name}` });
              onClose(true);
            } catch (err) {
              Alert.alert("Couldn't merge", errorText(err));
            }
          },
        },
      ],
    );
  }
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Pressable onPress={() => onClose(false)} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Merge {source.name} into…</Text>
          <View style={{ width: 52 }} />
        </View>
        <FlatList
          data={others}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: space.lg, gap: space.sm }}
          ListEmptyComponent={<Text style={styles.meta}>No other brands.</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => merge(item)} style={[cardStyle, styles.row]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>{item.product_count} products</Text>
              </View>
              <Ionicons name="git-merge-outline" size={18} color={colors.primary} />
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 18, fontWeight: '800', color: colors.primaryDark },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cancel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text, flexShrink: 1 },
  actions: { gap: space.sm, marginTop: space.xl, paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, borderRadius: radius.sm },
});
