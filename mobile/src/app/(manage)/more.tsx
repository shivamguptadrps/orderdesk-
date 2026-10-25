import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { NotificationStatus } from '@/components/NotificationStatus';
import { BrandHeader, cardStyle, IconBubble, SectionHeader, ShortcutTile, type Tone } from '@/components/manage/kit';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDashboard, useManage, useTenant } from '@/lib/manage';
import { useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

export default function MoreScreen() {
  const { ws, current, tenantId, isOwner } = useManage();
  const dash = useDashboard(tenantId);
  const tenant = useTenant(tenantId);
  const router = useRouter();
  const qc = useQueryClient();
  const t = tenant.data;

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

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

  function shareCode() {
    if (!t?.join_code) return;
    void Share.share({ message: `Order from ${t.name} on the OrderDesk app. Add us with join code ${t.join_code}.` });
  }

  const importUrl = `${API_URL}/import`;
  const others = [...ws.shopOptions, ...ws.agentOptions, ...ws.manageOptions.filter((o) => o.tenantId !== tenantId)];

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 48 }}>
      <BrandHeader
        name={t?.name ?? current?.name ?? ''}
        logoUrl={t?.logo_url}
        color={t?.brand_color}
        kicker={ws.me.data?.name ?? ws.me.data?.phone}
        subtitle={`${isOwner ? 'Owner' : 'Staff'} · ${ws.me.data?.phone ?? ''}`}>
        {t?.join_code ? (
          <View style={styles.codeCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.codeLabel}>Join code for shops</Text>
              <Text style={styles.code}>{t.join_code}</Text>
            </View>
            <Pressable onPress={shareCode} style={styles.codeBtn} accessibilityRole="button">
              <Ionicons name="share-social" size={16} color={colors.primary} />
              <Text style={styles.codeBtnText}>Share</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/manage/settings')} style={styles.codeBtn} accessibilityRole="button">
              <Ionicons name="qr-code" size={16} color={colors.primary} />
              <Text style={styles.codeBtnText}>QR</Text>
            </Pressable>
          </View>
        ) : null}
      </BrandHeader>

      <View style={styles.body}>
        <SectionHeader title="Manage" />
        <View style={[cardStyle, styles.tiles]}>
          <ShortcutTile icon="storefront" tone="purple" label="Shops" badge={dash.data?.shops_waiting} onPress={() => router.push('/manage/shops')} style={styles.tile} />
          <ShortcutTile icon="people" tone="blue" label="Team" onPress={() => router.push('/manage/team')} style={styles.tile} />
          <ShortcutTile icon="bar-chart" tone="teal" label="Reports" onPress={() => router.push('/manage/reports')} style={styles.tile} />
          <ShortcutTile icon="alert-circle" tone="red" label="Low stock" badge={dash.data?.low_stock} onPress={() => router.push('/manage/stock')} style={styles.tile} />
          <ShortcutTile icon="images" tone="pink" label="Banners" onPress={() => router.push('/manage/banners')} style={styles.tile} />
          <ShortcutTile icon="qr-code" tone="green" label="Join QR" onPress={() => router.push('/manage/settings')} style={styles.tile} />
        </View>

        <SectionHeader title="Settings" />
        <View style={[cardStyle, { paddingHorizontal: space.lg }]}>
          <Row
            icon="color-palette"
            tone="amber"
            label="Business profile & brand"
            sub={isOwner ? 'Name, logo, colour, agent rules' : 'Owner only · view'}
            lock={!isOwner}
            onPress={() => router.push('/manage/settings')}
          />
          <Row icon="cloud-upload" tone="blue" label="Excel import" sub="Add many products from a computer" onPress={() => Alert.alert('Excel import', `On a computer, open:\n\n${importUrl}`, [
            { text: 'Close', style: 'cancel' },
            { text: 'Send link', onPress: () => void Share.share({ message: importUrl }) },
          ])} border />
          <Row icon="pulse" tone="green" label="Server connection" sub={API_URL.replace(/^https?:\/\//, '')} onPress={() => router.push('/health')} border />
        </View>

        <View style={{ height: space.md }} />
        <NotificationStatus />

        {(others.length > 0 || !ws.me.data?.shop) && (
          <>
            <SectionHeader title="Switch" />
            <View style={[cardStyle, { paddingHorizontal: space.lg }]}>
              {others.map((o, i) => (
                <Row
                  key={`${o.mode}-${o.tenantId}`}
                  icon={o.mode === 'manage' ? 'business' : o.mode === 'agent' ? 'briefcase' : 'cart'}
                  tone={o.mode === 'shop' ? 'green' : 'purple'}
                  label={o.mode === 'manage' ? `Manage ${o.name}` : o.mode === 'agent' ? `Agent for ${o.name}` : `Order from ${o.name}`}
                  sub={o.mode === 'shop' ? 'Shop as your own shop' : undefined}
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
              {!ws.me.data?.shop && (
                <Row icon="storefront" tone="grey" label="I also run a shop" sub="Set up a shop profile to order" onPress={() => router.push('/setup-shop')} border={others.length > 0} />
              )}
            </View>
          </>
        )}

        <Pressable onPress={logout} style={[cardStyle, styles.logout]} accessibilityRole="button">
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
        <Text style={styles.footer}>OrderDesk · {current?.name}</Text>
      </View>
    </ScrollView>
  );
}

function Row({
  icon,
  tone,
  label,
  sub,
  lock,
  border,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: Tone;
  label: string;
  sub?: string;
  lock?: boolean;
  border?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, border && styles.border, pressed && { opacity: 0.7 }]}>
      <IconBubble icon={icon} tone={tone} size={38} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {lock && <Ionicons name="lock-closed" size={14} color={colors.faint} />}
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: space.md,
  },
  codeLabel: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  code: { fontSize: 22, fontWeight: '900', color: colors.text, letterSpacing: 3 },
  codeBtn: { alignItems: 'center', gap: 2, backgroundColor: colors.primarySoft, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  codeBtnText: { fontSize: 11, fontWeight: '800', color: colors.primary },
  body: { paddingHorizontal: space.lg },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: space.sm },
  tile: { width: '33.33%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.xl, paddingVertical: space.md },
  logoutText: { color: colors.error, fontWeight: '800', fontSize: 15 },
  footer: { textAlign: 'center', color: colors.faint, fontSize: 12, marginTop: space.md },
});
