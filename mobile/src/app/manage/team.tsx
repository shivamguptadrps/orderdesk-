import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Banner, Button, Card, ErrorView, Field, SectionTitle, SkeletonList } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useManage, useMembers, useRefreshManage } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { Member } from '@/lib/types';

const ROLE_LABEL = { owner: 'Owner', staff: 'Staff', agent: 'Agent' };

export default function TeamScreen() {
  const { tenantId, base, isOwner, ws } = useManage();
  const members = useMembers(tenantId);
  const refresh = useRefreshManage();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'agent' | 'staff'>('agent');
  const [added, setAdded] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => api<Member>(`${base}/members`, { method: 'POST', body: { phone, name: name.trim() || null, role } }),
    onSuccess: async (m) => {
      setAdded(`${m.name ?? m.phone} added as ${ROLE_LABEL[m.role].toLowerCase()}. They log in with ${m.phone}.`);
      setPhone('');
      setName('');
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api(`${base}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
    onError: (err) => Alert.alert("Couldn't remove", errorText(err)),
  });

  if (members.isLoading) return <SkeletonList count={4} />;
  if (members.isError) return <ErrorView message={errorText(members.error)} onRetry={() => members.refetch()} />;
  const myId = ws.me.data?.id;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={members.isRefetching} onRefresh={() => void members.refetch()} />}>
      <Card style={{ paddingVertical: space.xs }}>
        {(members.data ?? []).map((m, i) => {
          const canRemove = m.role !== 'owner' && m.user_id !== myId && (isOwner || m.role === 'agent');
          return (
            <View key={m.user_id} style={[styles.row, i > 0 && styles.border]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{m.name ?? m.phone}</Text>
                <Text style={styles.meta}>
                  {ROLE_LABEL[m.role]} · {m.phone}
                  {m.role === 'agent' ? ` · ${m.assigned_shops} shop${m.assigned_shops === 1 ? '' : 's'}` : ''}
                </Text>
              </View>
              {canRemove && (
                <Pressable
                  onPress={() =>
                    Alert.alert(`Remove ${m.name ?? m.phone}?`, 'Their shops become unassigned. Orders they placed stay.', [
                      { text: 'Keep', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(m.user_id) },
                    ])
                  }>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </Card>

      <SectionTitle>Add someone</SectionTitle>
      <Card>
        {isOwner && (
          <View style={styles.roles}>
            {(['agent', 'staff'] as const).map((r) => (
              <Pressable key={r} onPress={() => setRole(r)} style={[styles.role, role === r && styles.roleActive]}>
                <Text style={[styles.roleText, role === r && { color: '#FFFFFF' }]}>{ROLE_LABEL[r]}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.hint}>
          {role === 'agent' ? 'Agents visit shops and place orders for them.' : 'Staff can approve orders and manage products, shops and stock.'}
        </Text>
        <Field label="Mobile number" value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
        <Field label="Name" value={name} onChangeText={setName} />
        {add.isError && <Banner kind="error" text={errorText(add.error)} />}
        {added && <Banner kind="ok" text={added} />}
        <Button
          title={`Add ${ROLE_LABEL[role].toLowerCase()}`}
          onPress={() => add.mutate()}
          loading={add.isPending}
          disabled={!/^[6-9]\d{9}$/.test(phone)}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  remove: { color: colors.error, fontWeight: '700' },
  roles: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  role: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  roleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleText: { fontWeight: '700', color: colors.text },
  hint: { fontSize: 13, color: colors.muted, marginBottom: space.md },
});
