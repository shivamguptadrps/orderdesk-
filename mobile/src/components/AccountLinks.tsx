import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, API_URL, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/** Small footer links: privacy policy and "Delete my account" (both required by the Play Store). */
export function AccountLinks() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await api('/me', { method: 'DELETE' });
      useSession.getState().reset();
      qc.clear();
      await useAuth.getState().signOut();
    } catch (err) {
      Alert.alert("Couldn't delete the account", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'You will be logged out on every phone. Your name, number, shop details, links to distributors and team roles are removed. Orders you placed stay with those distributors as their records. This cannot be undone.',
      [
        { text: 'Keep my account', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => void remove() },
      ],
    );
  }

  return (
    <View style={styles.row}>
      <Pressable onPress={() => Linking.openURL(`${API_URL}/privacy`)} hitSlop={8} accessibilityRole="link">
        <Text style={styles.link}>Privacy policy</Text>
      </Pressable>
      <Text style={styles.dot}>·</Text>
      <Pressable onPress={confirmDelete} hitSlop={8} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color={colors.error} /> : <Text style={[styles.link, { color: colors.error }]}>Delete my account</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  link: { fontSize: 13, fontWeight: '600', color: colors.muted, textDecorationLine: 'underline' },
  dot: { color: colors.faint },
});
