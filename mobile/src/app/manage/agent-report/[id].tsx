import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DayBars, PeriodPicker, Ranked, reportStyles, shortDate, Stat } from '@/components/manage/ReportParts';
import { Card, ErrorView, SectionTitle, Skeleton } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { inr, phoneLabel } from '@/lib/format';
import { useManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { AgentReport } from '@/lib/types';

/** One agent: sales, days, best shops and products, and assigned shops that haven't ordered. */
export default function AgentReportScreen() {
  const { id, days: daysParam, name } = useLocalSearchParams<{ id: string; days?: string; name?: string }>();
  const { tenantId, base } = useManage();
  const router = useRouter();
  const [days, setDays] = useState(Number(daysParam) || 7);
  const report = useQuery({
    queryKey: ['report', tenantId, 'agent', id, days],
    queryFn: () => api<AgentReport>(`${base}/reports/agents/${id}`, { query: { days } }),
    enabled: !!tenantId,
    placeholderData: (previous) => previous,
  });
  const r = report.data;
  const a = r?.agent;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={report.isRefetching && !report.isPlaceholderData} onRefresh={() => void report.refetch()} />}>
      <Stack.Screen options={{ title: a?.name ?? name ?? 'Agent' }} />
      <PeriodPicker days={days} onChange={setDays} />

      {report.isError ? (
        <ErrorView message={errorText(report.error)} onRetry={() => report.refetch()} />
      ) : !r || !a ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={140} style={{ borderRadius: radius.md }} />
          <Skeleton height={180} style={{ borderRadius: radius.md }} />
        </View>
      ) : (
        <View style={{ opacity: report.isPlaceholderData ? 0.5 : 1 }}>
          <Card style={reportStyles.hero}>
            <Text style={reportStyles.heroLabel}>{a.name}&apos;s sales · {days === 1 ? 'today' : `${days} days`}</Text>
            <Text style={reportStyles.heroValue}>{inr(a.value)}</Text>
            <View style={reportStyles.delta}>
              <Text style={reportStyles.deltaText}>{a.share}% of all sales</Text>
            </View>
            <View style={reportStyles.heroRow}>
              <Stat label="Orders" value={String(a.orders)} />
              <Stat label="Avg order" value={a.orders ? inr(a.average_order) : '–'} />
              <Stat label="Shops ordered" value={a.assigned_shops ? `${a.shops_ordered} / ${a.assigned_shops}` : String(a.shops_ordered)} />
            </View>
          </Card>
          <View style={styles.facts}>
            <Text style={reportStyles.muted}>
              {a.last_order_at ? `Last order ${shortDate(a.last_order_at)}` : 'No orders yet'}
              {a.shops_signed_up ? ` · signed up ${a.shops_signed_up} new shop${a.shops_signed_up === 1 ? '' : 's'}` : ''}
            </Text>
            <Pressable onPress={() => Linking.openURL(`tel:${a.phone}`)} hitSlop={8} style={styles.call}>
              <Ionicons name="call-outline" size={16} color={colors.primary} />
              <Text style={styles.callText}>{phoneLabel(a.phone)}</Text>
            </Pressable>
          </View>

          {r.days > 1 && (
            <>
              <SectionTitle>Sales per day</SectionTitle>
              <Card>
                <DayBars data={r.by_day} />
              </Card>
            </>
          )}

          <SectionTitle>{`Shops not ordered (${r.idle_shops.length})`}</SectionTitle>
          <Card style={{ paddingVertical: space.xs }}>
            {r.idle_shops.length === 0 ? (
              <Text style={[reportStyles.muted, { paddingVertical: space.md }]}>
                {a.assigned_shops ? 'Every assigned shop has ordered in this period.' : 'No shops are assigned to this agent.'}
              </Text>
            ) : (
              r.idle_shops.map((s, i) => (
                <View key={s.shop_id} style={[styles.idle, i > 0 && styles.border]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.meta}>{s.city}</Text>
                  </View>
                  <Text style={[styles.meta, !s.last_order_at && { color: colors.warn, fontWeight: '700' }]}>
                    {s.last_order_at ? `last ${shortDate(s.last_order_at)}` : 'never ordered'}
                  </Text>
                </View>
              ))
            )}
          </Card>
          <Text style={reportStyles.footnote}>Assigned shops with no order from anyone in this period. Oldest first, so the agent knows where to go.</Text>

          {r.top_shops.length > 0 && (
            <>
              <SectionTitle>Best shops</SectionTitle>
              <Ranked rows={r.top_shops.map((s) => ({ key: s.shop_id, name: s.name, meta: `${s.orders} order${s.orders === 1 ? '' : 's'}`, value: s.value }))} />
            </>
          )}
          {r.top_products.length > 0 && (
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
            </>
          )}
          <Pressable onPress={() => router.push({ pathname: '/manage/agent/[id]', params: { id: a.user_id, name: a.name } })} style={styles.link}>
            <Ionicons name="storefront-outline" size={18} color={colors.primary} />
            <Text style={styles.linkText}>Change assigned shops</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  facts: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginTop: space.sm },
  call: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  callText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  idle: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.xl, alignSelf: 'center', padding: space.sm },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
