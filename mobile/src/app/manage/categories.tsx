import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cardStyle } from '@/components/manage/kit';
import { NameModal } from '@/components/manage/NameModal';
import { categoryLook } from '@/components/shop/categoryLook';
import { Button, Empty, ErrorView, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { mediaUrl } from '@/lib/format';
import { useCategoriesFlat, useManage, useRefreshManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { FlatCategory } from '@/lib/types';

/** Owner/staff: the category tree (Staples › Sugar…), with add, reorder and a way into each category's features. */
export default function CategoriesScreen() {
  const { tenantId, base } = useManage();
  const router = useRouter();
  const refresh = useRefreshManage();
  const cats = useCategoriesFlat(tenantId);
  const [adding, setAdding] = useState<{ parent: FlatCategory | null } | null>(null);
  const [moving, setMoving] = useState(false);

  if (cats.isLoading) return <SkeletonList count={5} />;
  if (cats.isError) return <ErrorView message={errorText(cats.error)} onRetry={() => cats.refetch()} />;
  const all = cats.data ?? [];
  const tops = all.filter((c) => !c.parent_id);
  const kids = (id: string) => all.filter((c) => c.parent_id === id);
  const total = (c: FlatCategory): number => (c.product_count ?? 0) + kids(c.id).reduce((s, k) => s + total(k), 0);

  async function move(list: FlatCategory[], from: number, to: number) {
    const ids = list.map((c) => c.id);
    const [m] = ids.splice(from, 1);
    ids.splice(to, 0, m);
    setMoving(true);
    try {
      await api(`${base}/categories-order`, { method: 'PUT', body: { ids } });
      await refresh();
    } catch (err) {
      Alert.alert("Couldn't move", errorText(err));
    } finally {
      setMoving(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: 110, gap: space.md }}
        refreshControl={<RefreshControl refreshing={cats.isRefetching} onRefresh={() => void cats.refetch()} />}>
        <Text style={styles.help}>
          Shops browse your products by these categories. Tap one to rename it, add a photo, or set its features (like Variety for rice or
          Weight for sugar) that every product in it will ask for.
        </Text>

        {!tops.length && <Empty icon="folder-open-outline" title="No categories yet" text="Add your first category, e.g. Staples or Beverages." />}

        {tops.map((c, i) => {
          const look = categoryLook(c.name, i);
          const children = kids(c.id);
          return (
            <View key={c.id} style={[cardStyle, styles.card]}>
              <View style={styles.topRow}>
                <Pressable onPress={() => router.push({ pathname: '/manage/category/[id]', params: { id: c.id } })} style={styles.topMain}>
                  <View style={[styles.icon, { backgroundColor: look.bg }]}>
                    {c.image_url ? (
                      <Image source={{ uri: mediaUrl(c.image_url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <Ionicons name={look.icon} size={24} color={look.fg} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.name}</Text>
                    <Text style={styles.meta}>
                      {children.length ? `${children.length} sub-categor${children.length === 1 ? 'y' : 'ies'} · ` : ''}
                      {total(c)} product{total(c) === 1 ? '' : 's'}
                      {c.attributes.length ? ` · ${c.attributes.length} feature${c.attributes.length === 1 ? '' : 's'}` : ''}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.arrows}>
                  <Pressable disabled={i === 0 || moving} onPress={() => move(tops, i, i - 1)} hitSlop={6} accessibilityLabel={`Move ${c.name} up`}>
                    <Ionicons name="chevron-up" size={20} color={i === 0 ? colors.border : colors.muted} />
                  </Pressable>
                  <Pressable disabled={i === tops.length - 1 || moving} onPress={() => move(tops, i, i + 1)} hitSlop={6} accessibilityLabel={`Move ${c.name} down`}>
                    <Ionicons name="chevron-down" size={20} color={i === tops.length - 1 ? colors.border : colors.muted} />
                  </Pressable>
                </View>
              </View>

              {children.map((k) => (
                <Pressable key={k.id} onPress={() => router.push({ pathname: '/manage/category/[id]', params: { id: k.id } })} style={styles.child}>
                  <Ionicons name="return-down-forward" size={16} color={colors.faint} />
                  <Text style={styles.childName} numberOfLines={1}>
                    {k.name}
                  </Text>
                  <Text style={styles.childMeta}>
                    {total(k)} product{total(k) === 1 ? '' : 's'}
                    {k.attributes.length ? ` · ${k.attributes.length} feat.` : ''}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.faint} />
                </Pressable>
              ))}
              <Pressable onPress={() => setAdding({ parent: c })} style={styles.addSub}>
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={styles.addSubText}>Add sub-category in {c.name}</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Add category" icon="add" onPress={() => setAdding({ parent: null })} />
      </View>

      {adding && (
        <NameModal
          title={adding.parent ? `New sub-category in ${adding.parent.name}` : 'New category'}
          hint={adding.parent ? `e.g. Basmati Rice, Toor Dal. It gets ${adding.parent.name}'s features too.` : 'e.g. Dry fruits, Dairy, Stationery'}
          placeholder="Category name"
          saveLabel="Add"
          onClose={() => setAdding(null)}
          onSave={async (name) => {
            try {
              const created = await api<FlatCategory>(`${base}/categories`, { method: 'POST', body: { name, parent_id: adding.parent?.id ?? null } });
              await refresh();
              setAdding(null);
              router.push({ pathname: '/manage/category/[id]', params: { id: created.id, fresh: '1' } });
              return null;
            } catch (err) {
              return errorText(err);
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  card: { padding: space.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  topMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  arrows: { alignItems: 'center' },
  child: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 10, paddingHorizontal: space.sm, marginTop: 6, borderRadius: radius.sm, backgroundColor: colors.bg },
  childName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  childMeta: { fontSize: 12, color: colors.muted },
  addSub: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: space.md, paddingHorizontal: space.sm },
  addSubText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
