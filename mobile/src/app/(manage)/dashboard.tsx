import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Avatar, BrandHeader, cardStyle, HeaderIcon, IconBubble, SectionHeader, ShortcutTile, TONES, type Tone } from '@/components/manage/kit';
import { ErrorView, Skeleton, StatusBadge } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { greeting, inr, shortInr, timeAgo } from '@/lib/format';
import { useDashboard, useManage, useTenant } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { OrderSummary, Page, Report } from '@/lib/types';

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Distributor home: today's sales, what needs doing, shortcuts, recent orders, best sellers. */
export default function DashboardScreen() {
  const { tenantId, current, base, ws, isOwner } = useManage();
  const router = useRouter();
  const dash = useDashboard(tenantId);
  const tenant = useTenant(tenantId);
  const week = useQuery({ queryKey: ['report', tenantId, 7], queryFn: () => api<Report>(`${base}/reports`, { query: { days: 7 } }), enabled: !!tenantId });
  const recent = useQuery({
    queryKey: ['morders', tenantId, 'recent'],
    queryFn: () => api<Page<OrderSummary>>(`${base}/orders`, { query: { limit: 5 } }),
    enabled: !!tenantId,
  });

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

  const refresh = () => Promise.all([dash.refetch(), week.refetch(), recent.refetch(), tenant.refetch()]);
  const d = dash.data;
  const t = tenant.data;
  const days = week.data?.by_day ?? [];
  const today = days[days.length - 1];
  const yesterday = days[days.length - 2];
  const change = today && yesterday && yesterday.value > 0 ? Math.round(((today.value - yesterday.value) / yesterday.value) * 100) : null;
  const maxDay = Math.max(1, ...days.map((x) => x.value));
  const firstName = (ws.me.data?.name ?? '').split(' ')[0];

  function shareCode() {
    if (!t?.join_code) return;
    void Share.share({
      message: `Order from ${t.name} on the OrderDesk app. Download the app and add us with join code ${t.join_code}.`,
    });
  }

  if (dash.isError) return <ErrorView message={errorText(dash.error)} onRetry={() => dash.refetch()} />;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={dash.isRefetching} onRefresh={() => void refresh()} tintColor="#FFFFFF" />}>
      <BrandHeader
        name={t?.name ?? current?.name ?? ''}
        logoUrl={t?.logo_url}
        color={t?.brand_color}
        kicker={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        subtitle={isOwner ? 'Owner' : 'Staff'}
        right={<HeaderIcon icon="qr-code-outline" label="Join code" onPress={() => router.push('/manage/settings')} />}>
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>Today&apos;s sales</Text>
            {d ? <Text style={styles.heroValue}>{inr(d.today_value)}</Text> : <Skeleton height={36} width={160} style={{ opacity: 0.3, marginVertical: 4 }} />}
            <View style={styles.heroMeta}>
              <Text style={styles.heroMetaText}>
                {d ? `${d.today_orders} order${d.today_orders === 1 ? '' : 's'}` : ' '}
                {d && d.today_orders ? ` · avg ${shortInr(d.today_value / d.today_orders)}` : ''}
              </Text>
              {change !== null && (
                <View style={[styles.change, { backgroundColor: change >= 0 ? 'rgba(46,160,67,0.28)' : 'rgba(248,81,73,0.3)' }]}>
                  <Ionicons name={change >= 0 ? 'trending-up' : 'trending-down'} size={12} color="#FFFFFF" />
                  <Text style={styles.changeText}>
                    {change >= 0 ? '+' : ''}
                    {change}% vs yesterday
                  </Text>
                </View>
              )}
            </View>
          </View>
          {days.length > 0 && (
            <Pressable onPress={() => router.push('/manage/reports')} style={styles.spark} accessibilityLabel="Sales this week, open reports">
              <View style={styles.sparkBars}>
                {days.map((x, i) => (
                  <View key={x.date} style={styles.sparkCol}>
                    <View
                      style={[
                        styles.sparkBar,
                        { height: Math.max(3, (x.value / maxDay) * 46), opacity: i === days.length - 1 ? 1 : 0.55 },
                      ]}
                    />
                    <Text style={styles.sparkDay}>{WEEKDAY[new Date(x.date + 'T00:00:00').getDay()]}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.sparkLabel}>This week ›</Text>
            </Pressable>
          )}
        </View>
      </BrandHeader>

      <View style={styles.body}>
        <SectionHeader title="Needs your attention" />
        <View style={styles.grid}>
          <Attention
            icon="time"
            tone="amber"
            label="To approve"
            value={d?.pending_orders}
            calm="No orders waiting"
            onPress={() => router.navigate({ pathname: '/queue', params: { status: 'pending' } })}
          />
          <Attention
            icon="car"
            tone="blue"
            label="To dispatch"
            value={d?.to_dispatch}
            calm="Nothing to send"
            onPress={() => router.navigate({ pathname: '/queue', params: { status: 'approved' } })}
          />
          <Attention
            icon="storefront"
            tone="purple"
            label="Shops waiting"
            value={d?.shops_waiting}
            calm="No join requests"
            onPress={() => router.push('/manage/shops')}
          />
          <Attention
            icon="alert-circle"
            tone="red"
            label="Low stock"
            value={d?.low_stock}
            note={d?.out_of_stock ? `${d.out_of_stock} out of stock` : undefined}
            calm="Stock looks fine"
            onPress={() => router.push('/manage/stock')}
          />
        </View>

        <SectionHeader title="Quick actions" />
        <View style={[cardStyle, styles.actions]}>
          <ShortcutTile icon="add-circle" tone="blue" label="Add product" onPress={() => router.push({ pathname: '/manage/product/[id]', params: { id: 'new' } })} style={styles.action} />
          <ShortcutTile icon="share-social" tone="green" label="Share join code" onPress={shareCode} style={styles.action} />
          <ShortcutTile icon="person-add" tone="purple" label="Add agent" onPress={() => router.push('/manage/team')} style={styles.action} />
          <ShortcutTile icon="images" tone="pink" label="Banners" onPress={() => router.push('/manage/banners')} style={styles.action} />
          <ShortcutTile icon="layers" tone="amber" label="Stock" onPress={() => router.push('/manage/stock')} style={styles.action} />
          <ShortcutTile icon="bar-chart" tone="teal" label="Reports" onPress={() => router.push('/manage/reports')} style={styles.action} />
          <ShortcutTile icon="storefront" tone="grey" label="Shops" badge={d?.shops_waiting} onPress={() => router.push('/manage/shops')} style={styles.action} />
          <ShortcutTile icon="cloud-upload" tone="blue" label="Excel import" onPress={() => router.navigate('/more')} style={styles.action} />
        </View>

        <SectionHeader title="Recent orders" action="All orders" onAction={() => router.navigate({ pathname: '/queue', params: { status: 'all' } })} />
        <View style={[cardStyle, { paddingVertical: space.xs }]}>
          {recent.isLoading ? (
            <View style={{ padding: space.lg, gap: space.md }}>
              <Skeleton height={40} />
              <Skeleton height={40} />
            </View>
          ) : !recent.data?.items.length ? (
            <Text style={styles.empty}>No orders yet. Share your join code so shops can start ordering.</Text>
          ) : (
            recent.data.items.map((o, i) => (
              <Pressable
                key={o.id}
                onPress={() => router.push({ pathname: '/manage/order/[id]', params: { id: o.id } })}
                style={[styles.orderRow, i > 0 && styles.divider]}>
                <Avatar name={o.shop_name} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderShop} numberOfLines={1}>
                    {o.shop_name}
                  </Text>
                  <Text style={styles.orderMeta}>
                    #{o.order_no} · {timeAgo(o.created_at)}
                    {o.source === 'agent' && o.placed_by_name ? ` · ${o.placed_by_name}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.orderValue}>{inr(o.items_total)}</Text>
                  <StatusBadge status={o.status} />
                </View>
              </Pressable>
            ))
          )}
        </View>

        {(week.data?.top_products.length ?? 0) > 0 && (
          <>
            <SectionHeader title="Best sellers this week" action="Reports" onAction={() => router.push('/manage/reports')} />
            <View style={[cardStyle, { padding: space.lg, gap: space.md }]}>
              {week.data!.top_products.slice(0, 4).map((p, i) => {
                const top = week.data!.top_products[0].value || 1;
                return (
                  <View key={p.product_id ?? p.name}>
                    <View style={styles.bestRow}>
                      <Text style={styles.rank}>{i + 1}</Text>
                      <Text style={styles.bestName} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.bestValue}>{shortInr(p.value)}</Text>
                    </View>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.max(4, (p.value / top) * 100)}%` }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Attention({
  icon,
  tone,
  label,
  value,
  note,
  calm,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: Tone;
  label: string;
  value: number | undefined;
  note?: string;
  calm: string;
  onPress: () => void;
}) {
  const t = TONES[tone];
  const busy = (value ?? 0) > 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.attention, busy && { borderColor: t.fg + '55' }, pressed && { transform: [{ scale: 0.98 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? 0}`}>
      <View style={styles.attentionTop}>
        <IconBubble icon={icon} tone={busy ? tone : 'grey'} size={38} />
        <Ionicons name="chevron-forward" size={16} color={colors.faint} />
      </View>
      {value === undefined ? (
        <Skeleton height={28} width={40} style={{ marginTop: space.md }} />
      ) : (
        <Text style={[styles.attentionValue, { color: busy ? t.fg : colors.text }]}>{value}</Text>
      )}
      <Text style={styles.attentionLabel}>{label}</Text>
      <Text style={[styles.attentionNote, busy && note ? { color: t.fg, fontWeight: '700' } : null]} numberOfLines={1}>
        {busy ? (note ?? 'Tap to open') : calm}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.lg },
  heroLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
  heroValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '900', marginTop: 2 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: 4 },
  heroMetaText: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  change: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  changeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  spark: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.md, padding: space.sm, paddingBottom: 6 },
  sparkBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 62 },
  sparkCol: { alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  sparkBar: { width: 10, borderRadius: 3, backgroundColor: '#FFFFFF' },
  sparkDay: { color: 'rgba(255,255,255,0.75)', fontSize: 9, marginTop: 3 },
  sparkLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  body: { paddingHorizontal: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  attention: { width: '47%', flexGrow: 1, ...cardStyle, padding: space.md },
  attentionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  attentionValue: { fontSize: 28, fontWeight: '900', marginTop: space.sm },
  attentionLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  attentionNote: { fontSize: 12, color: colors.muted, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: space.sm },
  action: { width: '25%' },
  empty: { padding: space.lg, color: colors.muted, fontSize: 14 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  orderShop: { fontSize: 15, fontWeight: '700', color: colors.text },
  orderMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  orderValue: { fontSize: 15, fontWeight: '800', color: colors.text },
  bestRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rank: { width: 18, fontSize: 13, fontWeight: '800', color: colors.faint },
  bestName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  bestValue: { fontSize: 14, fontWeight: '800', color: colors.text },
  track: { height: 5, backgroundColor: colors.bg, borderRadius: 3, marginTop: 6, marginLeft: 26, overflow: 'hidden' },
  fill: { height: 5, backgroundColor: colors.primary, borderRadius: 3 },
});
