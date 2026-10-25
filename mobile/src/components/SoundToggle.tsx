import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/ui';
import { feedback, useFeedbackPrefs } from '@/lib/feedback';
import { colors, space } from '@/lib/theme';

/** "Sounds" on/off. Vibration stays on; the phone's silent switch also mutes sounds. */
export function SoundToggle() {
  const { sound, setSound } = useFeedbackPrefs();
  return (
    <Card style={{ paddingVertical: space.md }}>
      <View style={styles.row}>
        <Ionicons name={sound ? 'volume-high' : 'volume-mute'} size={22} color={sound ? colors.primary : colors.faint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Sounds</Text>
          <Text style={styles.sub}>Little sounds when you add items or an order goes through</Text>
        </View>
        <Switch
          value={sound}
          onValueChange={(on) => {
            setSound(on);
            if (on) feedback.add();
          }}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
