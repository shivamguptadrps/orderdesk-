import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import { STATUS_LABEL } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';

// ---------- buttons ----------

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style }: ButtonProps) {
  const off = disabled || loading;
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [styles.button, v.box, off && styles.disabled, pressed && !off && { opacity: 0.85 }, style]}>
      {loading ? (
        <ActivityIndicator color={v.text.color} />
      ) : (
        <View style={styles.row}>
          {icon && <Ionicons name={icon} size={18} color={v.text.color} style={{ marginRight: 6 }} />}
          <Text style={[styles.buttonText, v.text]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const buttonVariants = {
  primary: { box: { backgroundColor: colors.primary }, text: { color: '#FFFFFF' } },
  secondary: { box: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }, text: { color: colors.text } },
  danger: { box: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.error }, text: { color: colors.error } },
  ghost: { box: { backgroundColor: 'transparent' }, text: { color: colors.primary } },
};

// ---------- inputs ----------

type FieldProps = TextInputProps & { label: string; error?: string | null; hint?: string };

export function Field({ label, error, hint, style, ...props }: FieldProps) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.faint}
        style={[styles.input, error ? { borderColor: colors.error } : null, style]}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

// ---------- layout ----------

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// ---------- states ----------

export function Loading({ text }: { text?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      {text ? <Text style={[styles.muted, { marginTop: space.sm }]}>{text}</Text> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Ionicons name="cloud-offline-outline" size={40} color={colors.faint} />
      <Text style={[styles.muted, styles.centerText, { marginVertical: space.md }]}>{message}</Text>
      {onRetry && <Button title="Try again" variant="secondary" onPress={onRetry} />}
    </View>
  );
}

export function Empty({
  icon = 'file-tray-outline',
  title,
  text,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={44} color={colors.faint} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={[styles.muted, styles.centerText]}>{text}</Text> : null}
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Banner({ kind = 'info', text }: { kind?: 'info' | 'ok' | 'warn' | 'error'; text: string }) {
  const c = {
    info: [colors.primarySoft, colors.primaryDark],
    ok: [colors.okSoft, colors.ok],
    warn: [colors.warnSoft, colors.warn],
    error: [colors.errorSoft, colors.error],
  }[kind];
  return (
    <View style={[styles.banner, { backgroundColor: c[0] }]}>
      <Text style={{ color: c[1], fontSize: 14 }}>{text}</Text>
    </View>
  );
}

const STATUS_COLORS: Record<string, [string, string]> = {
  pending: [colors.warnSoft, colors.warn],
  approved: [colors.primarySoft, colors.primaryDark],
  dispatched: ['#FBEFFF', '#8250DF'],
  delivered: [colors.okSoft, colors.ok],
  active: [colors.okSoft, colors.ok],
  rejected: [colors.errorSoft, colors.error],
  cancelled: ['#EAEEF2', colors.muted],
  blocked: [colors.errorSoft, colors.error],
};

export function StatusBadge({ status }: { status: string }) {
  const [bg, fg] = STATUS_COLORS[status] ?? ['#EAEEF2', colors.muted];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{STATUS_LABEL[status] ?? status}</Text>
    </View>
  );
}

// ---------- quantity ----------

/** First allowed quantity for a pack: at least min, and a multiple of step. */
export function firstQty(min: number, step: number) {
  return Math.ceil(min / step) * step;
}

export function QtyStepper({
  value,
  min,
  step,
  max,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  step: number;
  max: number | null;
  onChange: (qty: number) => void;
  disabled?: boolean;
}) {
  const lowest = firstQty(min, step);
  const canDown = !disabled && value - step >= lowest;
  const canUp = !disabled && (max === null || value + step <= max);
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityLabel="Less"
        disabled={!canDown}
        onPress={() => onChange(value - step)}
        style={[styles.stepBtn, !canDown && styles.disabled]}>
        <Ionicons name="remove" size={20} color={colors.text} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        accessibilityLabel="More"
        disabled={!canUp}
        onPress={() => onChange(value + step)}
        style={[styles.stepBtn, !canUp && styles.disabled]}>
        <Ionicons name="add" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  errorText: { fontSize: 12, color: colors.error, marginTop: 4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  centerText: { textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: space.md, marginBottom: 4, textAlign: 'center' },
  banner: { borderRadius: radius.sm, padding: space.md, marginBottom: space.md },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
  },
  stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 44, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.text },
});
