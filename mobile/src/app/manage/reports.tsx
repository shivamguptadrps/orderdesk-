import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Empty, ErrorView, SectionTitle, Skeleton } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { inr, STATUS_LABEL } from '@/lib/format';
import { useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { Report } from '@/lib/types';

const PERIODS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '2026-10-24' -> '24 Oct' (dates come as plain days in India time). */
function dayLabel(iso: string, weekday = false) {
  const [y, m, d] = iso.split('-').map(Number);
  if (weekday) return WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${d} ${MONTHS[m - 1]}`;
}

/** Short money for tight spaces: ₹1.2L, ₹45K, ₹900. */
function shortInr(v: number) {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`;
  return `₹${Math.round(v)}`;
}

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

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={report.isRefetching && !report.isPlaceholderData} onRefresh={() => void report.refetch()} />}>
      <View style={styles.periods}>
        {PERIODS.map((p) => (
          <Pressable
            key={p.days}
            accessibilityRole="button"
            accessibilityState={{ selected: days === p.days }}
            onPress={() => setDays(p.days)}
            style={[styles.period, days === p.days && styles.periodActive]}>
            <Text style={[styles.periodText, days === p.days && styles.periodTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

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
          <Card style={styles.hero}>
            <Text style={styles.heroLabel}>
              Sales · {r.days === 1 ? 'today' : `${dayLabel(r.start)} – ${dayLabel(r.end)}`}
            </Text>
            <Text style={styles.heroValue}>{inr(r.value)}</Text>
            <View style={styles.heroRow}>
              <Stat label="Orders" value={String(r.orders)} />
              <Stat label="Avg order" value={r.orders ? inr(r.average_order) : '–'} />
              <Stat label="Shops ordering" value={String(r.shops_ordering)} />
            </View>
          </Card>
          <Text style={styles.footnote}>Rejected and cancelled orders are not counted.</Text>

          {r.days > 1 && (
            <>
              <SectionTitle>Sales per day</SectionTitle>
              <Card>
                <DayBars data={r.by_day} />
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
            {!Object.keys(r.status_counts).length && <Text style={styles.muted}>No orders in this period.</Text>}
            {r.orders > 0 && (
              <Text style={[styles.muted, { marginTop: space.sm }]}>
                Placed by: {[
                  r.by_source.shop ? `shops ${r.by_source.shop}` : null,
                  r.by_source.agent ? `agents ${r.by_source.agent}` : null,
                  r.by_source.admin ? `office ${r.by_source.admin}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {r.new_shops ? ` · ${r.new_shops} new shop${r.new_shops === 1 ? '' : 's'} joined` : ''}
              </Text>
            )}
          </Card>

          {r.orders === 0 ? (
            <View style={{ marginTop: space.xl }}>
              <Empty icon="bar-chart-outline" title="No sales yet" text="Top products and shops show up here once orders come in." />
            </View>
          ) : (
            <>
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

              <SectionTitle>Top shops</SectionTitle>
              <Ranked
                rows={r.top_shops.map((s) => ({
                  key: s.shop_id,
                  name: s.name,
                  meta: `${s.orders} order${s.orders === 1 ? '' : 's'}`,
                  value: s.value,
                }))}
              />

              {r.top_agents.length > 0 && (
                <>
                  <SectionTitle>Agents</SectionTitle>
                  <Ranked
                    rows={r.top_agents.map((a) => ({
                      key: a.user_id,
                      name: a.name,
                      meta: `${a.orders} order${a.orders === 1 ? '' : 's'}`,
                      value: a.value,
                    }))}
                  />
                </>
              )}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <View style={[styles.row, border && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/** One bar per day. Tap a bar to see that day's numbers. */
function DayBars({ data }: { data: Report['by_day'] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  const index = picked ?? data.length - 1;
  const shown = data[index];
  const few = data.length <= 7;
  const gap = data.length > 40 ? 1 : 2;
  return (
    <View>
      <View style={styles.barInfo}>
        <Text style={styles.barInfoDate}>{dayLabel(shown.date)}{picked === null ? ' (today)' : ''}</Text>
        <Text style={styles.barInfoValue}>
          {inr(shown.value)} · {shown.orders} order{shown.orders === 1 ? '' : 's'}
        </Text>
      </View>
      <View style={styles.chart} accessibilityLabel={`Sales per day, highest ${inr(max)}`}>
        <View style={styles.gridLine} />
        <Text style={styles.axisMax}>{shortInr(max)}</Text>
        <View style={[styles.bars, { gap }]}>
          {data.map((d, i) => (
            <Pressable
              key={d.date}
              onPress={() => setPicked(i)}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityLabel={`${dayLabel(d.date)}: ${inr(d.value)}, ${d.orders} orders`}
              style={styles.barSlot}>
              <View
                style={[
                  styles.bar,
                  { height: d.value ? Math.max(3, (d.value / max) * 120) : 1 },
                  !d.value && styles.barZero,
                  i === index && d.value > 0 && styles.barPicked,
                ]}
              />
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.axis}>
        {few ? (
          data.map((d) => (
            <Text key={d.date} style={[styles.axisText, { flex: 1, textAlign: 'center' }]}>
              {dayLabel(d.date, true)}
            </Text>
          ))
        ) : (
          <>
            <Text style={styles.axisText}>{dayLabel(data[0].date)}</Text>
            <Text style={styles.axisText}>{dayLabel(data[data.length - 1].date)}</Text>
          </>
        )}
      </View>
    </View>
  );
}

type RankedRow = { key: string; name: string; meta: string; value: number; onPress?: () => void };

/** A ranked list with a thin bar showing each row's share of the top row. */
function Ranked({ rows }: { rows: RankedRow[] }) {
  const top = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Card style={{ paddingVertical: space.xs }}>
      {rows.map((r, i) => (
        <Pressable key={r.key} onPress={r.onPress} disabled={!r.onPress} style={[styles.ranked, i > 0 && styles.rowBorder]}>
          <Text style={styles.rank}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <View style={styles.rankedTop}>
              <Text style={styles.rankedName} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={styles.rankedValue}>{inr(r.value)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.max(2, (r.value / top) * 100)}%` }]} />
            </View>
            <Text style={styles.rankedMeta}>{r.meta}</Text>
          </View>
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  periods: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, padding: 4, marginBottom: space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  period: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  periodActive: { backgroundColor: colors.primary },
  periodText: { fontSize: 14, fontWeight: '600', color: colors.text },
  periodTextActive: { color: '#FFFFFF' },
  hero: { backgroundColor: colors.primary, borderColor: colors.primary },
  heroLabel: { color: '#DCE8FF', fontSize: 14, fontWeight: '600' },
  heroValue: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', marginTop: 4 },
  heroRow: { flexDirection: 'row', marginTop: space.md, gap: space.sm },
  statValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  statLabel: { color: '#DCE8FF', fontSize: 12 },
  footnote: { fontSize: 12, color: colors.muted, marginTop: space.sm },
  muted: { fontSize: 13, color: colors.muted },
  row: { flexDirection: 'row', paddingVertical: space.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text },
  rowValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  barInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.md },
  barInfoDate: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  barInfoValue: { fontSize: 13, color: colors.text, fontWeight: '700' },
  chart: { height: 132, justifyContent: 'flex-end' },
  gridLine: { position: 'absolute', top: 12, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  axisMax: { position: 'absolute', top: -4, right: 0, fontSize: 10, color: colors.faint, backgroundColor: colors.card, paddingLeft: 4 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 120, borderBottomWidth: 1, borderBottomColor: colors.border },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { backgroundColor: colors.primary, opacity: 0.55, borderTopLeftRadius: 4, borderTopRightRadius: 4, maxWidth: 28, width: '100%', alignSelf: 'center' },
  barZero: { backgroundColor: colors.border, opacity: 1, borderRadius: 0 },
  barPicked: { opacity: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 11, color: colors.muted },
  ranked: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.md, gap: space.md },
  rank: { width: 18, fontSize: 14, fontWeight: '700', color: colors.faint, marginTop: 1 },
  rankedTop: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  rankedName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  rankedValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  track: { height: 4, backgroundColor: colors.bg, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  rankedMeta: { fontSize: 12, color: colors.muted, marginTop: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.xl, alignSelf: 'center', padding: space.sm },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
