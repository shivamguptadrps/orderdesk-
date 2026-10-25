import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { NotificationStatus } from '@/components/NotificationStatus';
import { Card, SectionTitle } from '@/components/ui';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDashboard, useManage } from '@/lib/manage';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

export default function MoreScreen() {
  const { ws, current, tenantId, isOwner } = useManage();
  const dash = useDashboard(tenantId);
  const router = useRouter();
  const qc = useQueryClient();

  function logout() {
    Alert.alert('Log out?', '', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          useSession.getState().reset();
          qc.clear();
          await useAuth.getState().signOut();
        },
      },
    ]);
  }

  const importUrl = `${API_URL}/import`;
  const others = [...ws.shopOptions, ...ws.agentOptions, ...ws.manageOptions.filter((o) => o.tenantId !== tenantId)];

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}>
      <Card style={{ paddingVertical: space.xs }}>
        <Item icon="bar-chart-outline" label="Reports" sub="Sales, top products and shops" onPress={() => router.push('/manage/reports')} />
        <Item icon="storefront-outline" label="Shops" badge={dash.data?.shops_waiting} sub="Approve requests, assign agents" onPress={() => router.push('/manage/shops')} border />
        <Item icon="alert-circle-outline" label="Low stock" badge={dash.data?.low_stock} sub="Products running out" onPress={() => router.push('/manage/stock')} border />
        <Item icon="people-outline" label="Team" sub="Agents and staff" onPress={() => router.push('/manage/team')} border />
        <Item icon="qr-code-outline" label="Join code & settings" sub={isOwner ? 'QR to share, name, colour, logo' : 'QR to share'} onPress={() => router.push('/manage/settings')} border />
      </Card>

      <SectionTitle>Excel import</SectionTitle>
      <Card>
        <Text style={styles.text}>Adding many products is easier on a computer. On the laptop, open:</Text>
        <Text style={styles.link} selectable>
          {importUrl}
        </Text>
        <Pressable onPress={() => Share.share({ message: importUrl })} style={styles.inline}>
          <Ionicons name="share-outline" size={16} color={colors.primary} />
          <Text style={styles.linkText}>Send this link</Text>
        </Pressable>
      </Card>

      {others.length > 0 && (
        <>
          <SectionTitle>Switch</SectionTitle>
          <Card style={{ paddingVertical: space.xs }}>
            {others.map((o, i) => (
              <Item
                key={`${o.mode}-${o.tenantId}`}
                icon={o.mode === 'manage' ? 'business-outline' : o.mode === 'agent' ? 'briefcase-outline' : 'cart-outline'}
                label={o.mode === 'manage' ? `Manage ${o.name}` : o.mode === 'agent' ? `Agent for ${o.name}` : `Order from ${o.name}`}
                border={i > 0}
                onPress={() => {
                  const s = useSession.getState();
                  if (o.mode === 'manage') s.chooseManageMode(o.tenantId);
                  else if (o.mode === 'agent') s.chooseAgentMode(o.tenantId);
                  else s.chooseShopMode(o.tenantId);
                  router.replace(o.mode === 'manage' ? '/dashboard' : o.mode === 'agent' ? '/agent/shops' : '/home');
                }}
              />
            ))}
          </Card>
        </>
      )}
      {!ws.me.data?.shop && (
        <Pressable onPress={() => router.push('/setup-shop')} style={[styles.inline, { marginTop: space.md }]}>
          <Text style={styles.linkText}>I also run a shop</Text>
        </Pressable>
      )}

      <SectionTitle>App</SectionTitle>
      <NotificationStatus />
      <View style={{ height: space.md }} />
      <Card style={{ paddingVertical: space.xs }}>
        <Item icon="pulse-outline" label="Server connection" onPress={() => router.push('/health')} />
        <Item icon="log-out-outline" label="Log out" danger onPress={logout} border />
      </Card>
      <Text style={styles.footer}>
        {current?.name} · {current?.role === 'owner' ? 'Owner' : 'Staff'} · {ws.me.data?.phone}
      </Text>
    </ScrollView>
  );
}

function Item({
  icon,
  label,
  sub,
  badge,
  onPress,
  border,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  badge?: number;
  onPress: () => void;
  border?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.item, border && styles.border]}>
      <Ionicons name={icon} size={22} color={danger ? colors.error : colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, danger && { color: colors.error }]}>{label}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      {!danger && <Ionicons name="chevron-forward" size={18} color={colors.faint} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  badge: { backgroundColor: colors.error, borderRadius: 999, minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  text: { fontSize: 14, color: colors.text },
  link: { fontSize: 15, color: colors.primaryDark, fontWeight: '700', marginTop: space.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
  linkText: { color: colors.primary, fontWeight: '700' },
  footer: { textAlign: 'center', color: colors.faint, fontSize: 12, marginTop: space.xl },
});
