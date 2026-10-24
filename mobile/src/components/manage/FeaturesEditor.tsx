import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Field } from '@/components/ui';
import { colors, space } from '@/lib/theme';
import type { Attribute } from '@/lib/types';

export type FeatureValues = Record<string, string | boolean>;

/** Form values (strings/booleans) -> what the API expects (numbers for number features, empty ones dropped). */
export function featuresForApi(attrs: Attribute[], values: FeatureValues): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const a of attrs) {
    const v = values[a.key];
    if (v === undefined || v === '') continue;
    if (a.type === 'number' && typeof v === 'string') {
      const n = Number(v.replace(',', '.'));
      out[a.key] = Number.isFinite(n) ? n : v;
    } else {
      out[a.key] = v;
    }
  }
  return out;
}

export function featuresFromApi(values: Record<string, string | number | boolean>): FeatureValues {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]));
}

/** One input per category feature: text, number, choice chips, or yes/no switch. */
export function FeaturesEditor({
  attributes,
  values,
  onChange,
}: {
  attributes: Attribute[];
  values: FeatureValues;
  onChange: (values: FeatureValues) => void;
}) {
  if (!attributes.length) return <Text style={styles.muted}>This category has no features to fill in.</Text>;
  const set = (key: string, value: string | boolean) => onChange({ ...values, [key]: value });

  return (
    <View>
      {attributes.map((a) => {
        const label = `${a.label}${a.unit ? ` (${a.unit})` : ''}${a.required ? ' *' : ''}`;
        if (a.type === 'boolean') {
          return (
            <View key={a.key} style={styles.switchRow}>
              <Text style={styles.label}>{label}</Text>
              <Switch value={values[a.key] === true} onValueChange={(v) => set(a.key, v)} />
            </View>
          );
        }
        if (a.type === 'select') {
          return (
            <View key={a.key} style={{ marginBottom: space.md }}>
              <Text style={styles.label}>{label}</Text>
              <View style={styles.chips}>
                {a.options.map((opt) => {
                  const active = values[a.key] === opt;
                  return (
                    <Pressable key={opt} onPress={() => set(a.key, active ? '' : opt)} style={[styles.chip, active && styles.chipActive]}>
                      <Text style={[styles.chipText, active && { color: '#FFFFFF' }]}>{opt}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        }
        return (
          <Field
            key={a.key}
            label={label}
            value={typeof values[a.key] === 'string' ? (values[a.key] as string) : ''}
            onChangeText={(t) => set(a.key, t)}
            keyboardType={a.type === 'number' ? 'decimal-pad' : 'default'}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontWeight: '600', color: colors.text },
});
