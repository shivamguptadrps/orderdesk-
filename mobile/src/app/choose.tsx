import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Loading, SectionTitle } from '@/components/ui';
import { useWorkspace, type WorkspaceOption } from '@/lib/data';
import { useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

/** Switch between distributors (as a shop) and agent work. */
export default function ChooseScreen() {
  const ws = useWorkspace();
  const router = useRouter();
  if (ws.loading) return <Loading />;

  function pick(o: WorkspaceOption) {
    if (o.mode === 'shop') {
      useSession.getState().chooseShopMode(o.tenantId);
      router.back();
    } else if (o.mode === 'manage') {
      useSession.getState().chooseManageMode(o.tenantId);
      router.replace('/dashboard');
    } else {
      useSession.getState().chooseAgentMode(o.tenantId);
      router.replace('/agent/shops');
    }
  }

  const isCurrent = (o: WorkspaceOption) => ws.current?.tenantId === o.tenantId && ws.current.mode === o.mode;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      {ws.shopOptions.length > 0 && <SectionTitle>For my shop</SectionTitle>}
      {ws.shopOptions.map((o) => (
        <Option key={`s-${o.tenantId}`} title={o.name} icon="business-outline" active={isCurrent(o)} onPress={() => pick(o)} />
      ))}
      {ws.agentOptions.length > 0 && <SectionTitle>As an agent</SectionTitle>}
      {ws.agentOptions.map((o) => (
        <Option key={`a-${o.tenantId}`} title={`Agent for ${o.name}`} icon="briefcase-outline" active={isCurrent(o)} onPress={() => pick(o)} />
      ))}
      {ws.manageOptions.length > 0 && <SectionTitle>Distributor tools</SectionTitle>}
      {ws.manageOptions.map((o) => (
        <Option key={`m-${o.tenantId}`} title={`Manage ${o.name}`} icon="speedometer-outline" active={isCurrent(o)} onPress={() => pick(o)} />
      ))}
      {ws.me.data?.shop && (
        <Button
          title="Add distributor"
          icon="add"
          variant="ghost"
          onPress={() => router.replace('/add-distributor')}
          style={{ marginTop: space.lg }}
        />
      )}
    </ScrollView>
  );
}

function Option({
  title,
  icon,
  active,
  onPress,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.option, active && styles.active]}>
      <Ionicons name={icon} size={22} color={active ? colors.primary : colors.muted} />
      <Text style={styles.title}>{title}</Text>
      {active && <Ionicons name="checkmark" size={22} color={colors.primary} />}
      {!active && <View style={{ width: 22 }} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginBottom: space.sm,
  },
  active: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
});
