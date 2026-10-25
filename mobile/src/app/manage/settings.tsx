import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';

import { Banner, Button, Card, ErrorView, Field, Loading, SectionTitle } from '@/components/ui';
import { api, buildUrl, errorText, uploadImage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadAndShare } from '@/lib/files';
import { mediaUrl } from '@/lib/format';
import { useManage, useRefreshManage, useTenant } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { TenantInfo } from '@/lib/types';

const SWATCHES = ['#1F6FEB', '#1A7F37', '#CF222E', '#8250DF', '#BF8700', '#0E7490', '#DB2777', '#1F2328'];

export default function SettingsScreen() {
  const { tenantId, base, isOwner } = useManage();
  const tenant = useTenant(tenantId);
  if (tenant.isLoading || !tenantId) return <Loading />;
  if (tenant.isError) return <ErrorView message={errorText(tenant.error)} onRetry={() => tenant.refetch()} />;
  return <Settings key={tenant.data!.join_code ?? ''} t={tenant.data!} base={base} isOwner={isOwner} />;
}

function Settings({ t, base, isOwner }: { t: TenantInfo; base: string; isOwner: boolean }) {
  const refresh = useRefreshManage();
  const [name, setName] = useState(t.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [qrKey, setQrKey] = useState(0);
  const code = t.join_code ?? '';

  async function run(label: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(label);
    setSaved(null);
    try {
      await fn();
      await refresh();
      if (done) setSaved(done);
    } catch (err) {
      Alert.alert("Couldn't save", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const put = (body: object, done?: string) => run('settings', () => api(`${base}/settings`, { method: 'PUT', body }), done);

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets?.length) return;
    const a = result.assets[0];
    await run('logo', () => uploadImage(`${base}/logo`, a), 'Logo updated');
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Card style={{ alignItems: 'center' }}>
        <Text style={styles.small}>Shops join you with this code</Text>
        <Text style={styles.code} selectable>
          {code}
        </Text>
        <Image
          key={qrKey}
          source={{ uri: buildUrl(`${base}/join-qr.png`), headers: { Authorization: `Bearer ${useAuth.getState().accessToken}` } }}
          style={styles.qr}
          contentFit="contain"
          cachePolicy="none"
        />
        <View style={styles.row}>
          <Button
            title="Share code"
            icon="logo-whatsapp"
            style={{ flex: 1 }}
            onPress={() =>
              Share.share({
                message: `Order from ${t.name} on the OrderDesk app.\nOur join code: ${code}\n(Open the app › Add distributor › enter the code)`,
              })
            }
          />
          <Button
            title="Share QR"
            icon="qr-code-outline"
            variant="secondary"
            style={{ flex: 1 }}
            loading={busy === 'qr'}
            onPress={() => run('qr', () => downloadAndShare(`${base}/join-qr.png`, `join-${code}.png`, 'image/png', 'Join code QR'))}
          />
        </View>
        {isOwner && (
          <Button
            title="Make a new code"
            variant="ghost"
            onPress={() =>
              Alert.alert('Make a new join code?', 'The old code stops working for new shops. Shops that already joined stay.', [
                { text: 'Keep old code', style: 'cancel' },
                {
                  text: 'New code',
                  onPress: () =>
                    run('code', async () => {
                      await api(`${base}/join-code/regenerate`, { method: 'POST' });
                      setQrKey((k) => k + 1);
                    }),
                },
              ])
            }
          />
        )}
      </Card>

      {!isOwner ? (
        <>
          <SectionTitle>Business profile & brand</SectionTitle>
          <Card>
            <View style={styles.lockNote}>
              <Ionicons name="lock-closed" size={16} color={colors.warn} />
              <Text style={styles.lockText}>Only the owner can change these. Ask the owner, or log in with the owner&apos;s number.</Text>
            </View>
            <View style={styles.logoRow}>
              <View style={styles.logo}>
                {t.logo_url ? <Image source={{ uri: mediaUrl(t.logo_url) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="image-outline" size={28} color={colors.faint} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{t.name}</Text>
                <View style={[styles.row, { marginTop: 6, alignItems: 'center' }]}>
                  <View style={[styles.swatchSmall, { backgroundColor: t.brand_color ?? colors.primary }]} />
                  <Text style={styles.small}>{t.logo_url ? 'Logo set' : 'No logo yet'} · brand colour</Text>
                </View>
              </View>
            </View>
          </Card>
        </>
      ) : (
        <>
          {saved && (
            <View style={{ marginTop: space.md }}>
              <Banner kind="ok" text={saved} />
            </View>
          )}
          <SectionTitle>Business</SectionTitle>
          <Card>
            <Field label="Business name" value={name} onChangeText={setName} />
            <Button title="Save name" variant="secondary" loading={busy === 'settings'} disabled={!name.trim() || name.trim() === t.name} onPress={() => put({ name: name.trim() }, 'Name saved')} />

            <Text style={[styles.label, { marginTop: space.lg }]}>Brand colour</Text>
            <View style={styles.swatches}>
              {SWATCHES.map((c) => (
                <Pressable key={c} onPress={() => put({ brand_color: c }, 'Colour saved')} style={[styles.swatch, { backgroundColor: c }]} accessibilityLabel={`Colour ${c}`}>
                  {t.brand_color?.toUpperCase() === c && <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
                </Pressable>
              ))}
            </View>

            <Text style={[styles.label, { marginTop: space.lg }]}>Logo</Text>
            <View style={styles.logoRow}>
              <View style={styles.logo}>
                {t.logo_url ? <Image source={{ uri: mediaUrl(t.logo_url) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="image-outline" size={28} color={colors.faint} />}
              </View>
              <Button title={t.logo_url ? 'Change logo' : 'Add logo'} variant="secondary" loading={busy === 'logo'} onPress={pickLogo} />
            </View>
          </Card>

          <SectionTitle>Agents</SectionTitle>
          <Card>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Auto-approve shops added by agents</Text>
                <Text style={styles.small}>Off: you approve each new shop first (safer).</Text>
              </View>
              <Switch value={!!t.agent_shops_auto_approve} onValueChange={(v) => put({ agent_shops_auto_approve: v }, v ? 'Agent shops are approved automatically' : 'You will approve agent shops')} />
            </View>
            <View style={[styles.switchRow, { marginTop: space.lg }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Agents can order for all shops</Text>
                <Text style={styles.small}>Off: each agent sees only the shops you assign (More › Shops or Team). On: every agent sees every active shop.</Text>
              </View>
              <Switch value={!!t.agents_see_all_shops} onValueChange={(v) => put({ agents_see_all_shops: v }, v ? 'Agents now see all shops' : 'Agents see only their assigned shops')} />
            </View>
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  small: { fontSize: 13, color: colors.muted },
  code: { fontSize: 34, fontWeight: '800', letterSpacing: 6, color: colors.text, marginVertical: space.sm },
  qr: { width: 200, height: 200, marginBottom: space.md, backgroundColor: colors.card },
  row: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lockNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.warnSoft, borderRadius: radius.sm, padding: space.sm, marginBottom: space.md },
  lockText: { flex: 1, fontSize: 13, color: colors.warn, fontWeight: '600', lineHeight: 18 },
  swatchSmall: { width: 16, height: 16, borderRadius: 8, marginRight: 6 },
  logo: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
