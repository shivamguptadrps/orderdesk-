import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Loading, SectionTitle, StatusBadge } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useWorkspace } from '@/lib/data';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

export default function ProfileScreen() {
  const ws = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  if (ws.loading || !ws.me.data) return <Loading />;
  const me = ws.me.data;
  const current = ws.current;
  const manages = me.memberships.filter((m) => m.role === 'owner' || m.role === 'staff');

  function logout() {
    Alert.alert('Log out?', 'You can log in again with your phone number.', [
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

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={ws.me.isRefetching} onRefresh={() => {
            void ws.me.refetch();
            void ws.distributors.refetch();
          }} />}>
      <Card>
        <Text style={styles.name}>{me.name ?? 'No name yet'}</Text>
        <Text style={styles.muted}>{me.phone}</Text>
      </Card>

      {me.shop ? (
        <>
          <SectionTitle>My shop</SectionTitle>
          <Card>
            <Text style={styles.itemTitle}>{me.shop.shop_name}</Text>
            <Text style={styles.muted}>
              {me.shop.address}, {me.shop.city} - {me.shop.pincode}
            </Text>
            <Button title="Edit shop details" variant="ghost" onPress={() => router.push('/setup-shop')} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
          </Card>

          <SectionTitle>My distributors</SectionTitle>
          <Card style={{ paddingVertical: space.xs }}>
            {(ws.distributors.data ?? []).map((d, i) => {
              const selected = current?.mode === 'shop' && current.tenantId === d.tenant_id;
              return (
                <Pressable
                  key={d.tenant_id}
                  disabled={d.status !== 'active'}
                  onPress={() => {
                    useSession.getState().chooseShopMode(d.tenant_id);
                    router.navigate('/home');
                  }}
                  style={[styles.listRow, i > 0 && styles.border]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{d.name}</Text>
                    {selected && <Text style={styles.selected}>Ordering from here</Text>}
                  </View>
                  <StatusBadge status={d.status} />
                </Pressable>
              );
            })}
            {!ws.distributors.data?.length && <Text style={[styles.muted, { paddingVertical: space.md }]}>None yet.</Text>}
          </Card>
          <Button title="Add distributor" icon="add" variant="secondary" onPress={() => router.push('/add-distributor')} style={{ marginTop: space.md }} />
        </>
      ) : (
        <>
          <SectionTitle>My shop</SectionTitle>
          <Button title="Set up a shop profile" variant="secondary" onPress={() => router.push('/setup-shop')} />
        </>
      )}

      {ws.agentOptions.length > 0 && (
        <>
          <SectionTitle>Agent work</SectionTitle>
          <Card style={{ paddingVertical: space.xs }}>
            {ws.agentOptions.map((o, i) => {
              const selected = current?.mode === 'agent' && current.tenantId === o.tenantId;
              return (
                <Pressable
                  key={o.tenantId}
                  onPress={() => {
                    useSession.getState().chooseAgentMode(o.tenantId);
                    router.push('/agent/shops');
                  }}
                  style={[styles.listRow, i > 0 && styles.border]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>Agent for {o.name}</Text>
                    <Text style={selected ? styles.selected : styles.muted}>
                      {selected ? `Active${current?.agentShop ? ` · ordering for ${current.agentShop.name}` : ''}` : 'Tap to work as agent'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.faint} />
                </Pressable>
              );
            })}
          </Card>
          {current?.mode === 'agent' && ws.shopOptions.length > 0 && (
            <Button
              title="Order for my own shop instead"
              variant="ghost"
              onPress={() => {
                useSession.getState().chooseShopMode(ws.shopOptions[0].tenantId);
                router.navigate('/home');
              }}
            />
          )}
        </>
      )}

      {manages.length > 0 && (
        <>
          <SectionTitle>Distributor tools</SectionTitle>
          <Card>
            <Text style={styles.itemTitle}>{manages.map((m) => `${m.tenant_name} (${m.role})`).join(', ')}</Text>
            <Text style={styles.muted}>Approve orders, manage products, stock, shops and your team.</Text>
            <Button
              title="Open distributor tools"
              icon="speedometer-outline"
              style={{ marginTop: space.md }}
              onPress={() => {
                useSession.getState().chooseManageMode(manages[0].tenant_id);
                router.replace('/dashboard');
              }}
            />
          </Card>
        </>
      )}

      <SectionTitle>App</SectionTitle>
      <Button title="Check server connection" variant="secondary" icon="pulse-outline" onPress={() => router.push('/health')} />
      <Button title="Log out" variant="danger" icon="log-out-outline" onPress={logout} style={{ marginTop: space.md }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '800', color: colors.text },
  muted: { fontSize: 13, color: colors.muted, marginTop: 2 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  selected: { fontSize: 12, color: colors.ok, fontWeight: '600', marginTop: 2 },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, gap: space.sm },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
