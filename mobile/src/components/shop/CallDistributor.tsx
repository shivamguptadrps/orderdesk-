import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { phoneLabel } from '@/lib/format';
import { useTenant } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';

/**
 * "Call Gupta Traders · 98111 22233 to confirm fast". Opens the phone dialer.
 * `onGreen` is the white style for the full-screen order-placed page. Hidden until the number is known.
 */
export function CallDistributor({ tenantId, name, onGreen = false }: { tenantId?: string; name?: string; onGreen?: boolean }) {
  const tenant = useTenant(tenantId);
  const phone = tenant.data?.contact_phone;
  if (!phone) return null;
  const who = name || tenant.data?.name || 'distributor';

  async function call() {
    const url = `tel:${phone}`;
    try {
      // No canOpenURL check: Android 11+ answers "no" for tel: unless the app declares it.
      await Linking.openURL(url);
    } catch {
      Alert.alert(`Call ${who}`, phoneLabel(phone!));
    }
  }

  return (
    <Pressable
      onPress={call}
      accessibilityRole="button"
      accessibilityLabel={`Call ${who} on ${phoneLabel(phone)}`}
      style={({ pressed }) => [styles.box, onGreen ? styles.boxGreen : styles.boxLight, pressed && { opacity: 0.85 }]}>
      <View style={[styles.icon, onGreen ? { backgroundColor: '#FFFFFF' } : { backgroundColor: colors.ok }]}>
        <Ionicons name="call" size={18} color={onGreen ? '#137333' : '#FFFFFF'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, onGreen && { color: '#FFFFFF' }]} numberOfLines={1}>
          Call {who} · {phoneLabel(phone)}
        </Text>
        <Text style={[styles.sub, onGreen && { color: 'rgba(255,255,255,0.85)' }]}>To confirm your order fast</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={onGreen ? '#FFFFFF' : colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.md, padding: space.md },
  boxLight: { backgroundColor: colors.okSoft, borderWidth: 1, borderColor: colors.ok },
  boxGreen: { backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 1 },
});
