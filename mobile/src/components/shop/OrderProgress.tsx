import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, space } from '@/lib/theme';
import type { OrderStatus } from '@/lib/types';

const STEPS = [
  { key: 'pending', label: 'Placed' },
  { key: 'approved', label: 'Approved' },
  { key: 'dispatched', label: 'On the way' },
  { key: 'delivered', label: 'Delivered' },
] as const;

// Each step is a column; the first hugs the left edge, the last the right, the middle two are centred.
const ALIGN = ['flex-start', 'center', 'center', 'flex-end'] as const;
// Where each dot's centre sits along the line (0..1), to draw the green part up to the current step.
const AT = [0, 0.375, 0.625, 1];

/** Delivery-style tracker: Placed → Approved → On the way → Delivered. */
export function OrderProgress({ status }: { status: OrderStatus }) {
  if (status === 'rejected' || status === 'cancelled') {
    return (
      <View style={styles.stopped}>
        <Ionicons name="close-circle" size={16} color={status === 'rejected' ? colors.error : colors.muted} />
        <Text style={[styles.stoppedText, status === 'rejected' && { color: colors.error }]}>
          {status === 'rejected' ? 'Rejected by distributor' : 'Cancelled'}
        </Text>
      </View>
    );
  }
  const reached = STEPS.findIndex((s) => s.key === status);
  return (
    <View style={styles.wrap} accessibilityLabel={`Order status: ${STEPS[reached].label}`}>
      <View style={styles.lineBox}>
        <View style={styles.line} />
        <View style={[styles.line, styles.lineOn, { width: `${AT[reached] * 100}%` }]} />
      </View>
      <View style={styles.row}>
        {STEPS.map((s, i) => (
          <View key={s.key} style={[styles.col, { alignItems: ALIGN[i] }]}>
            <View style={[styles.dot, i <= reached && styles.dotOn]}>
              {i <= reached ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
            </View>
            <Text style={[styles.label, i <= reached && styles.labelOn]} numberOfLines={1}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const DOT = 18;

const styles = StyleSheet.create({
  wrap: { marginTop: space.md },
  lineBox: { position: 'absolute', top: DOT / 2 - 1.5, left: DOT / 2, right: DOT / 2, height: 3 },
  line: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: colors.border },
  lineOn: { right: undefined, backgroundColor: colors.ok },
  row: { flexDirection: 'row' },
  col: { flex: 1 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.border,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { backgroundColor: colors.ok },
  label: { fontSize: 11, color: colors.faint, marginTop: 4 },
  labelOn: { color: colors.text, fontWeight: '600' },
  stopped: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md },
  stoppedText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
});
