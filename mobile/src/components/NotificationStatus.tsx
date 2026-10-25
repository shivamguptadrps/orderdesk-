import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui';
import { registerForPush, usePush, type PushStatus } from '@/lib/push';
import { colors, space } from '@/lib/theme';

const TEXT: Record<PushStatus, { title: string; sub: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  on: { title: 'Notifications on', sub: 'You get a message when orders are placed or change.', icon: 'notifications', color: colors.ok },
  denied: { title: 'Notifications off', sub: 'Tap to turn them on in phone settings.', icon: 'notifications-off-outline', color: colors.warn },
  unsupported: { title: 'Notifications not available here', sub: 'They work in the installed app on a real phone.', icon: 'notifications-off-outline', color: colors.muted },
  'not-configured': { title: 'Notifications not set up yet', sub: 'The app build needs its Expo project id (eas init).', icon: 'construct-outline', color: colors.muted },
  error: { title: "Couldn't turn on notifications", sub: 'Tap to try again.', icon: 'alert-circle-outline', color: colors.error },
  unknown: { title: 'Checking notifications…', sub: '', icon: 'notifications-outline', color: colors.muted },
};

/** Shows whether this phone gets push notifications, with a fix when it doesn't. */
export function NotificationStatus() {
  const { status, detail } = usePush();
  const t = TEXT[status];
  const action = status === 'denied' ? () => Linking.openSettings() : status === 'error' ? () => void registerForPush() : undefined;
  return (
    <Card style={{ paddingVertical: space.md }}>
      <Pressable onPress={action} disabled={!action} style={styles.row}>
        <Ionicons name={t.icon} size={22} color={t.color} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t.title}</Text>
          {t.sub ? <Text style={styles.sub}>{status === 'error' && detail ? `${detail} ${t.sub}` : t.sub}</Text> : null}
        </View>
        {action && <Ionicons name="chevron-forward" size={18} color={colors.faint} />}
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
});
