import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { dayLabel, DayBars, Delta, HourBars, PeriodPicker, Ranked, reportStyles, Row, shortDate, Stat } from '@/components/manage/ReportParts';
import { Card, Empty, ErrorView, SectionTitle, Skeleton } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { inr, STATUS_LABEL } from '@/lib/format';
import { useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { OrderSource, Report } from '@/lib/types';

const CHANNEL: Record<OrderSource, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  shop: { label: "Shops' own app", icon: 'storefront-outline' },
  agent: { label: 'Agents', icon: 'briefcase-outline' },
  admin: { label: 'Office (for shops)', icon: 'business-outline' },
  counter: { label: 'Counter sales', icon: 'cash-outline' },
};

export default function ReportsScreen() {
  const { tenantId, base } = useManage();
  const router = useRouter();
  const [days, setDays] = useState<number>(7);
  const report = useQuery({
    queryKey: ['report', tenantId, days],
    queryFn: () => api<Report>(`${base}/reports`, { query: { days } }),
    enabled: !!tenantId,
    placeholderData: (previous) => previous,
  });
  const r = report.data;
  const period = days === 1 ? 'yesterday' : `previous ${days} days`;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={report.isRefetching && !report.isPlaceholderData} onRefresh={() => void report.refetch()} />}>
      <PeriodPicker days={days} onChange={setDays} />

      {report.isError ? (
        <ErrorView message={errorText(report.error)} onRetry={() => report.refetch()} />
      ) : !r ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={120} style={{ borderRadius: radius.md }} />
          <Skeleton height={180} style={{ borderRadius: radius.md }} />
          <Skeleton height={200} style={{ borderRadius: radius.md }} />
        </View>
      ) : (
        <View style={{ opacity: report.isPlaceholderData ? 0.5 : 1 }}>
          <Card style={reportStyles.hero}>
            <Text style={reportStyles.heroLabel}>Sales · {r.days === 1 ? 'today' : `${dayLabel(r.start)} – ${dayLabel(r.end)}`}</Text>
            <Text style={reportStyles.heroValue}>{inr(r.value)}</Text>
            <Delta now={r.value} before={r.prev_value} period={period} />
            <View style={reportStyles.heroRow}>
              <Stat label="Orders" value={String(r.orders)} />
              <Stat label="Avg order" value={r.orders ? inr(r.average_order) : '–'} />
              <Stat label="Shops ordering" value={String(r.shops_ordering)} />
            </View>
          </Card>
          <Text style={reportStyles.footnote}>Rejected and cancelled orders are not counted.</Text>

          {r.payments && (r.payments.paid_value > 0 || r.payments.unpaid_value > 0) && (
            <View style={styles.payRow}>
              <View style={[styles.payTile, { backgroundColor: colors.okSoft }]}>
                <Text style={[styles.payLabel, { color: colors.ok }]}>Marked paid</Text>
                <Text style={styles.payValue}>{inr(r.payments.paid_value)}</Text>
              </View>
              <View style={[styles.payTile, { backgroundColor: colors.warnSoft }]}>
                <Text style={[styles.payLabel, { color: colors.warn }]}>To collect</Text>
                <Text style={styles.payValue}>{inr(r.payments.unpaid_value)}</Text>
                <Text style={styles.paySub}>
                  {r.payments.unpaid_orders} order{r.payments.unpaid_orders === 1 ? '' : 's'} sent, not marked paid
                </Text>
              </View>
            </View>
          )}

          {r.days > 1 && (
            <>
              <SectionTitle>Sales per day</SectionTitle>
              <Card>
                <DayBars data={r.by_day} />
              </Card>
            </>
          )}

          {!!r.channels?.length && (
            <>
              <SectionTitle>Where sales come from</SectionTitle>
              <Card style={{ paddingVertical: space.sm }}>
                {r.channels.map((c, i) => {
                  const share = r.value ? Math.round((100 * c.value) / r.value) : 0;
                  return (
                    <View key={c.source} style={[styles.channel, i > 0 && styles.border]}>
                      <Ionicons name={CHANNEL[c.source]?.icon ?? 'ellipse-outline'} size={18} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <View style={styles.channelTop}>
                          <Text style={styles.channelName}>{CHANNEL[c.source]?.label ?? c.source}</Text>
                          <Text style={styles.channelValue}>{inr(c.value)}</Text>
                        </View>
                        <View style={styles.track}>
                          <View style={[styles.fill, { width: `${Math.max(2, share)}%` }]} />
                        </View>
                        <Text style={styles.meta}>
                          {share}% · {c.orders} order{c.orders === 1 ? '' : 's'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </Card>
            </>
          )}

          <SectionTitle>Orders</SectionTitle>
          <Card style={{ paddingVertical: space.sm }}>
            {(['pending', 'approved', 'dispatched', 'delivered', 'rejected', 'cancelled'] as const)
              .filter((s) => r.status_counts[s])
              .map((s, i) => (
                <Row key={s} label={STATUS_LABEL[s] ?? s} value={String(r.status_counts[s])} border={i > 0} />
              ))}
            {!Object.keys(r.status_counts).length && <Text style={reportStyles.muted}>No orders in this period.</Text>}
            {r.new_shops > 0 && (
              <Text style={[reportStyles.muted, { marginTop: space.sm }]}>
                {r.new_shops} new shop{r.new_shops === 1 ? '' : 's'} joined
              </Text>
            )}
          </Card>

          {r.orders === 0 ? (
            <View style={{ marginTop: space.xl }}>
              <Empty icon="bar-chart-outline" title="No sales yet" text="Top products, agents and shops show up here once orders come in." />
            </View>
          ) : (
            <>
              {!!r.agents?.length && (
                <>
                  <SectionTitle>Agents</SectionTitle>
                  <Ranked
                    rows={r.agents.map((a) => ({
                      key: a.user_id,
                      name: a.name,
                      value: a.value,
                      right: a.value ? `${inr(a.value)} · ${a.share}%` : 'No sales',
                      meta: [
                        `${a.orders} order${a.orders === 1 ? '' : 's'}`,
                        a.assigned_shops ? `${a.shops_ordered} of ${a.assigned_shops} shops ordered` : `${a.shops_ordered} shop${a.shops_ordered === 1 ? '' : 's'}`,
                        a.shops_signed_up ? `${a.shops_signed_up} new shop${a.shops_signed_up === 1 ? '' : 's'}` : null,
                        a.last_order_at ? `last order ${shortDate(a.last_order_at)}` : 'no orders yet',
                      ]
                        .filter(Boolean)
                        .join(' · '),
                      onPress: () => router.push({ pathname: '/manage/agent-report/[id]', params: { id: a.user_id, days: String(days), name: a.name } }),
                    }))}
                  />
                  <Text style={reportStyles.footnote}>Tap an agent for their days, shops and products.</Text>
                </>
              )}

              {!!r.top_categories?.length && (
                <>
                  <SectionTitle>Top categories</SectionTitle>
                  <Ranked rows={r.top_categories.map((c) => ({ key: c.category_id ?? c.name, name: c.name, meta: `${c.pieces} pcs`, value: c.value }))} />
                </>
              )}

              <SectionTitle>Top products</SectionTitle>
              <Ranked
                rows={r.top_products.map((p) => ({
                  key: p.product_id ?? p.name,
                  name: p.name,
                  meta: `${p.pieces} pcs · ${p.orders} order${p.orders === 1 ? '' : 's'}`,
                  value: p.value,
                  onPress: p.product_id ? () => router.push(`/manage/product/${p.product_id}`) : undefined,
                }))}
              />

              {r.top_shops.length > 0 && (
                <>
                  <SectionTitle>Top shops</SectionTitle>
                  <Ranked rows={r.top_shops.map((s) => ({ key: s.shop_id, name: s.name, meta: `${s.orders} order${s.orders === 1 ? '' : 's'}`, value: s.value }))} />
                </>
              )}

              {!!r.by_hour?.length && r.days > 1 && (
                <>
                  <SectionTitle>Busy hours</SectionTitle>
                  <Card>
                    <HourBars data={r.by_hour} />
                  </Card>
                </>
              )}
            </>
          )}

          {!!r.quiet_shops?.length && (
            <>
              <SectionTitle>Shops gone quiet</SectionTitle>
              <Card style={{ paddingVertical: space.xs }}>
                <Text style={[reportStyles.muted, { paddingTop: space.sm }]}>
                  Ordered before, but not {days === 1 ? 'today' : `in the last ${days} days`}
                  {r.quiet_shops_total && r.quiet_shops_total > r.quiet_shops.length ? ` (${r.quiet_shops_total} in all, latest first)` : ''}.
                </Text>
                {r.quiet_shops.map((s, i) => (
                  <View key={s.shop_id} style={[styles.quiet, i > 0 && styles.border]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.channelName} numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text style={styles.meta}>
                        {s.city}
                        {s.agent_name ? ` · agent ${s.agent_name}` : ' · no agent'}
                      </Text>
                    </View>
                    <Text style={styles.meta}>last {shortDate(s.last_order_at)}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}

          <Pressable onPress={() => router.push('/manage/stock')} style={styles.link}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.linkText}>See low stock</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  payRow: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  payTile: { flex: 1, borderRadius: radius.md, padding: space.md },
  payLabel: { fontSize: 12, fontWeight: '800' },
  payValue: { fontSize: 20, fontWeight: '900', color: colors.text, marginTop: 2 },
  paySub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  channel: { flexDirection: 'row', gap: space.md, paddingVertical: space.md, alignItems: 'flex-start' },
  channelTop: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  channelName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  channelValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  track: { height: 4, backgroundColor: colors.bg, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  meta: { fontSize: 12, color: colors.muted, marginTop: 3 },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.xl, alignSelf: 'center', padding: space.sm },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
