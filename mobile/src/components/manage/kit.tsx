import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isHex, shade } from '@/lib/color';
import { mediaUrl } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';

/** Distributor brand colour, or the app blue. */
export function brandOf(color: string | null | undefined) {
  return isHex(color) ? color : colors.primary;
}

/** Coloured top band with the distributor's logo, name and a line under it. Children go below. */
export function BrandHeader({
  name,
  logoUrl,
  color,
  kicker,
  subtitle,
  right,
  children,
}: {
  name: string;
  logoUrl?: string | null;
  color?: string | null;
  kicker?: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const brand = brandOf(color);
  return (
    <LinearGradient colors={[shade(brand, -0.3), brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.band}>
      <View style={[styles.blob, { width: 220, height: 220, right: -70, top: -90 }]} />
      <View style={[styles.blob, { width: 140, height: 140, right: 60, bottom: -80 }]} />
      <SafeAreaView edges={['top']}>
        <View style={styles.headRow}>
          <View style={styles.logo}>
            {logoUrl ? (
              <Image source={{ uri: mediaUrl(logoUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Text style={[styles.logoText, { color: brand }]}>{name.slice(0, 1).toUpperCase()}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
        {children}
      </SafeAreaView>
    </LinearGradient>
  );
}

/** Round translucent icon button for the coloured header. */
export function HeaderIcon({ icon, onPress, label }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel={label} style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={20} color="#FFFFFF" />
    </Pressable>
  );
}

export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal' | 'pink' | 'grey';
export const TONES: Record<Tone, { bg: string; fg: string }> = {
  blue: { bg: '#E8F0FE', fg: '#1557C0' },
  green: { bg: '#DAFBE1', fg: '#1A7F37' },
  amber: { bg: '#FFF4E0', fg: '#B76E00' },
  red: { bg: '#FFEBE9', fg: '#CF222E' },
  purple: { bg: '#FBEFFF', fg: '#8250DF' },
  teal: { bg: '#DDF4F8', fg: '#0E7490' },
  pink: { bg: '#FFE6F1', fg: '#BE185D' },
  grey: { bg: '#EEF1F4', fg: '#57606A' },
};

/** A rounded square with a coloured icon. */
export function IconBubble({ icon, tone, size = 44 }: { icon: keyof typeof Ionicons.glyphMap; tone: Tone; size?: number }) {
  const t = TONES[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={size * 0.5} color={t.fg} />
    </View>
  );
}

/** Grid tile: coloured icon, label, optional red count badge. */
export function ShortcutTile({
  icon,
  tone,
  label,
  badge,
  onPress,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: Tone;
  label: string;
  badge?: number;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, style, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button">
      <View>
        <IconBubble icon={icon} tone={tone} size={46} />
        {badge ? (
          <View style={styles.tileBadge}>
            <Text style={styles.tileBadgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const AVATAR_TONES: Tone[] = ['blue', 'green', 'amber', 'purple', 'teal', 'pink', 'red'];

/** Initial in a coloured circle; the colour is stable for the same name. */
export function Avatar({ name, size = 42 }: { name: string; size?: number }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const t = TONES[AVATAR_TONES[hash % AVATAR_TONES.length]];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: t.fg, fontWeight: '800', fontSize: size * 0.36 }}>{initials || '?'}</Text>
    </View>
  );
}

/** Section heading with an optional link on the right. */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} style={styles.sectionAction}>
          <Text style={styles.sectionActionText}>{action}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { overflow: 'hidden', paddingBottom: space.lg },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.09)' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm },
  logo: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoText: { fontSize: 24, fontWeight: '900' },
  kicker: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  name: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  subtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },
  headerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  tile: { alignItems: 'center', gap: 6, paddingVertical: space.sm },
  tileLabel: { fontSize: 12, fontWeight: '600', color: colors.text, textAlign: 'center', lineHeight: 15 },
  tileBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.error,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionActionText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});

export const cardStyle: ViewStyle = {
  backgroundColor: colors.card,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: '#EEF0F3',
};
