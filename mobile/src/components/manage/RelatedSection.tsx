import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Skeleton } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { mediaUrl } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';
import type { ManageProduct, Page, RelatedLink } from '@/lib/types';

const SHOWN = 8; // shops see up to 8 under a product

function reason(link: RelatedLink) {
  if (link.pinned) return 'Pinned by you';
  if (link.bought_together) return `Bought together in ${link.bought_together} order${link.bought_together === 1 ? '' : 's'}`;
  return 'Similar product';
}

/** What shops see under this product ("Customers also buy"), and pinning products by hand. */
export function RelatedSection({ product, base }: { product: ManageProduct; base: string }) {
  const qc = useQueryClient();
  const key = ['mrelated', product.id];
  const links = useQuery({ queryKey: key, queryFn: () => api<RelatedLink[]>(`${base}/products/${product.id}/related`) });
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const found = useQuery({
    queryKey: ['mproducts', 'pick', base, q],
    queryFn: () => api<Page<ManageProduct>>(`${base}/products`, { query: { q, limit: 6 } }),
    enabled: q.length >= 2,
  });

  const pin = useMutation({
    mutationFn: ({ other, on }: { other: string; on: boolean }) =>
      api<RelatedLink[]>(`${base}/products/${product.id}/related/${other}`, { method: on ? 'PUT' : 'DELETE' }),
    onSuccess: (data, { on }) => {
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: ['strip'] });
      if (on) setSearch('');
    },
    onError: (err) => Alert.alert("Couldn't change the link", errorText(err)),
  });

  const list = (links.data ?? []).filter((l) => l.status === 'active').slice(0, SHOWN);
  const linkedIds = new Set((links.data ?? []).filter((l) => l.pinned).map((l) => l.product_id));
  const results = (found.data?.items ?? []).filter((p) => p.id !== product.id);

  return (
    <View>
      <Text style={styles.help}>
        Shops see these under this product. They update every night from what shops order together. Pin a product to always show it.
      </Text>

      {links.isLoading ? (
        <View style={{ gap: space.sm }}>
          <Skeleton height={44} />
          <Skeleton height={44} />
        </View>
      ) : links.isError ? (
        <Text style={styles.error}>{errorText(links.error)}</Text>
      ) : list.length === 0 ? (
        <Text style={styles.muted}>Nothing yet. Add products to the same category, or pin one below.</Text>
      ) : (
        list.map((l, i) => {
          const busy = pin.isPending && pin.variables?.other === l.product_id;
          return (
            <View key={l.product_id} style={[styles.row, i > 0 && styles.border]}>
              <Thumb uri={l.image} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {l.name}
                </Text>
                <Text style={[styles.reason, l.pinned && { color: colors.primary }]}>{reason(l)}</Text>
              </View>
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Pressable
                  hitSlop={10}
                  accessibilityLabel={l.pinned ? `Unpin ${l.name}` : `Pin ${l.name}`}
                  onPress={() => pin.mutate({ other: l.product_id, on: !l.pinned })}>
                  <Ionicons name={l.pinned ? 'pin' : 'pin-outline'} size={20} color={l.pinned ? colors.primary : colors.faint} />
                </Pressable>
              )}
            </View>
          );
        })
      )}

      <View style={styles.searchBox}>
        <Ionicons name="add-circle-outline" size={18} color={colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Pin another product: type its name"
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          autoCorrect={false}
        />
      </View>
      {q.length >= 2 &&
        (found.isLoading ? (
          <ActivityIndicator style={{ marginTop: space.sm }} color={colors.primary} />
        ) : results.length === 0 ? (
          <Text style={[styles.muted, { marginTop: space.sm }]}>No product matches “{q}”.</Text>
        ) : (
          results.map((p) => (
            <Pressable
              key={p.id}
              disabled={linkedIds.has(p.id) || pin.isPending}
              onPress={() => pin.mutate({ other: p.id, on: true })}
              style={[styles.row, styles.border]}>
              <Thumb uri={p.thumbnails[0] ?? null} />
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
                {p.name}
              </Text>
              {linkedIds.has(p.id) ? (
                <Text style={styles.reason}>Pinned</Text>
              ) : (
                <Ionicons name="pin-outline" size={20} color={colors.primary} />
              )}
            </Pressable>
          ))
        ))}
    </View>
  );
}

function Thumb({ uri }: { uri: string | null }) {
  return (
    <View style={styles.thumb}>
      {uri ? (
        <Image source={{ uri: mediaUrl(uri) }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Ionicons name="cube-outline" size={18} color={colors.faint} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: 13, color: colors.muted, marginBottom: space.md },
  muted: { fontSize: 14, color: colors.muted },
  error: { fontSize: 14, color: colors.error },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  reason: { fontSize: 12, color: colors.muted, marginTop: 2 },
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
});
