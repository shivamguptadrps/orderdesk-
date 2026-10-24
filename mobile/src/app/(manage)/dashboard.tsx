import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, ErrorView, Loading, SectionTitle } from '@/components/ui';
import { errorText } from '@/lib/api';
import { inr } from '@/lib/format';
import { useDashboard, useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';

export default function DashboardScreen() {
  const { tenantId, current } = useManage();
  const router = useRouter();
  const dash = useDashboard(tenantId);

  if (dash.isLoading) return <Loading />;
  if (dash.isError) return <ErrorView message={errorText(dash.error)} onRetry={() => dash.refetch()} />;
  const d = dash.data!;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={dash.isRefetching} onRefresh={() => void dash.refetch()} />}>
      <Card style={styles.today}>
        <Text style={styles.todayLabel}>Today</Text>
        <Text style={styles.todayValue}>{inr(d.today_value)}</Text>
        <Text style={styles.todayMeta}>
          {d.today_orders} order{d.today_orders === 1 ? '' : 's'} · {current?.role === 'owner' ? 'Owner' : 'Staff'}
        </Text>
      </Card>

      <SectionTitle>Needs your attention</SectionTitle>
      <View style={styles.grid}>
        <Tile
          icon="time-outline"
          label="To approve"
          value={d.pending_orders}
          tone={d.pending_orders ? 'warn' : 'calm'}
          onPress={() => router.navigate({ pathname: '/queue', params: { status: 'pending' } })}
        />
        <Tile
          icon="car-outline"
          label="To dispatch"
          value={d.to_dispatch}
          tone={d.to_dispatch ? 'info' : 'calm'}
          onPress={() => router.navigate({ pathname: '/queue', params: { status: 'approved' } })}
        />
        <Tile
          icon="storefront-outline"
          label="Shops waiting"
          value={d.shops_waiting}
          tone={d.shops_waiting ? 'warn' : 'calm'}
          onPress={() => router.push('/manage/shops')}
        />
        <Tile
          icon="alert-circle-outline"
          label="Low stock"
          value={d.low_stock}
          sub={d.out_of_stock ? `${d.out_of_stock} out of stock` : undefined}
          tone={d.out_of_stock ? 'error' : d.low_stock ? 'warn' : 'calm'}
          onPress={() => router.push('/manage/stock')}
        />
      </View>
    </ScrollView>
  );
}

const TONES = {
  calm: [colors.card, colors.text],
  info: [colors.primarySoft, colors.primaryDark],
  warn: [colors.warnSoft, colors.warn],
  error: [colors.errorSoft, colors.error],
} as const;

function Tile({
  icon,
  label,
  value,
  sub,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  sub?: string;
  tone: keyof typeof TONES;
  onPress: () => void;
}) {
  const [bg, fg] = TONES[tone];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, { backgroundColor: bg }, pressed && { opacity: 0.85 }]}>
      <Ionicons name={icon} size={22} color={fg} />
      <Text style={[styles.tileValue, { color: fg }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {sub ? <Text style={[styles.tileSub, { color: fg }]}>{sub}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  today: { backgroundColor: colors.primary, borderColor: colors.primary },
  todayLabel: { color: '#DCE8FF', fontSize: 14, fontWeight: '600' },
  todayValue: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', marginTop: 4 },
  todayMeta: { color: '#DCE8FF', fontSize: 13, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    width: '47%',
    flexGrow: 1,
    borderRadius: radius.md,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tileValue: { fontSize: 28, fontWeight: '800', marginTop: space.sm },
  tileLabel: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  tileSub: { fontSize: 12, marginTop: 2, fontWeight: '600' },
});
