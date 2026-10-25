import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui';
import { inr, shortInr } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';

export const PERIODS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '2026-10-24' -> '24 Oct' (dates come as plain days in India time). */
export function dayLabel(iso: string, weekday = false) {
  const [y, m, d] = iso.split('-').map(Number);
  if (weekday) return WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${d} ${MONTHS[m - 1]}`;
}

/** A timestamp as '24 Oct' (or 'today' / 'yesterday'). */
export function shortDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** 7 vs 5 -> '+40%'; nothing before -> null. */
export function change(now: number, before: number): { text: string; up: boolean } | null {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return { text: `${pct >= 0 ? '+' : ''}${pct}%`, up: pct >= 0 };
}

/** '+12% vs previous 7 days' under the big number. */
export function Delta({ now, before, period }: { now: number; before?: number; period: string }) {
  if (before === undefined) return null;
  const c = change(now, before);
  return (
    <View style={reportStyles.delta}>
      {c && <Ionicons name={c.up ? 'trending-up' : 'trending-down'} size={14} color="#FFFFFF" />}
      <Text style={reportStyles.deltaText}>{c ? `${c.text} vs ${period}` : `No sales the ${period}`}</Text>
    </View>
  );
}

export function PeriodPicker({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return (
    <View style={styles.periods}>
      {PERIODS.map((p) => (
        <Pressable
          key={p.days}
          accessibilityRole="button"
          accessibilityState={{ selected: days === p.days }}
          onPress={() => onChange(p.days)}
          style={[styles.period, days === p.days && styles.periodActive]}>
          <Text style={[styles.periodText, days === p.days && styles.periodTextActive]}>{p.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function Row({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <View style={[styles.row, border && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/** One bar per day. Tap a bar to see that day's numbers. */
export function DayBars({ data }: { data: { date: string; orders: number; value: number }[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  const index = picked ?? data.length - 1;
  const shown = data[index];
  const few = data.length <= 7;
  const gap = data.length > 40 ? 1 : 2;
  return (
    <View>
      <View style={styles.barInfo}>
        <Text style={styles.barInfoDate}>
          {dayLabel(shown.date)}
          {picked === null ? ' (today)' : ''}
        </Text>
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

const hourLabel = (h: number) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);

/** Orders per hour of the day (India time). Shows 6am–10pm, wider if orders came outside it. Tap a bar for its count. */
export function HourBars({ data }: { data: { hour: number; orders: number }[] }) {
  const counts = new Map(data.map((d) => [d.hour, d.orders]));
  const from = Math.min(6, ...data.map((d) => d.hour));
  const to = Math.max(22, ...data.map((d) => d.hour));
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const max = Math.max(...hours.map((h) => counts.get(h) ?? 0), 1);
  const busiest = hours.reduce((a, b) => ((counts.get(b) ?? 0) > (counts.get(a) ?? 0) ? b : a), hours[0]);
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? busiest;
  return (
    <View>
      <View style={styles.barInfo}>
        <Text style={styles.barInfoDate}>
          {hourLabel(shown)}–{hourLabel((shown + 1) % 24)}
          {picked === null ? ' (busiest)' : ''}
        </Text>
        <Text style={styles.barInfoValue}>
          {counts.get(shown) ?? 0} order{(counts.get(shown) ?? 0) === 1 ? '' : 's'}
        </Text>
      </View>
      <View style={[styles.bars, { height: 80, gap: 2 }]}>
        {hours.map((h) => {
          const n = counts.get(h) ?? 0;
          return (
            <Pressable key={h} onPress={() => setPicked(h)} hitSlop={{ top: 8, bottom: 8 }} style={styles.barSlot} accessibilityLabel={`${hourLabel(h)}: ${n} orders`}>
              <View style={[styles.bar, { height: n ? Math.max(3, (n / max) * 80) : 1 }, !n && styles.barZero, h === shown && n > 0 && styles.barPicked]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{hourLabel(from)}</Text>
        <Text style={styles.axisText}>{hourLabel(Math.round((from + to) / 2))}</Text>
        <Text style={styles.axisText}>{hourLabel(to)}</Text>
      </View>
    </View>
  );
}

export type RankedRow = { key: string; name: string; meta: string; value: number; right?: string; onPress?: () => void };

/** A ranked list with a thin bar showing each row's share of the top row. */
export function Ranked({ rows }: { rows: RankedRow[] }) {
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
              <Text style={styles.rankedValue}>{r.right ?? inr(r.value)}</Text>
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

export const reportStyles = StyleSheet.create({
  hero: { backgroundColor: colors.primary, borderColor: colors.primary },
  heroLabel: { color: '#DCE8FF', fontSize: 14, fontWeight: '600' },
  heroValue: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', marginTop: 4 },
  heroRow: { flexDirection: 'row', marginTop: space.md, gap: space.sm },
  footnote: { fontSize: 12, color: colors.muted, marginTop: space.sm },
  muted: { fontSize: 13, color: colors.muted },
  delta: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  deltaText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});

const styles = StyleSheet.create({
  periods: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, padding: 4, marginBottom: space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  period: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  periodActive: { backgroundColor: colors.primary },
  periodText: { fontSize: 14, fontWeight: '600', color: colors.text },
  periodTextActive: { color: '#FFFFFF' },
  statValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  statLabel: { color: '#DCE8FF', fontSize: 12 },
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
});
