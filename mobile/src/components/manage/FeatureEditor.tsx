import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Field } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { featureKey } from '@/lib/manage';
import { colors, radius, space } from '@/lib/theme';
import type { Attribute } from '@/lib/types';

const TYPES: { key: Attribute['type']; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'select', label: 'Choice list', hint: 'Pick one: e.g. Basmati / Kolam / Sona Masoori', icon: 'list' },
  { key: 'number', label: 'Number', hint: 'e.g. weight 5 kg, volume 500 ml', icon: 'calculator' },
  { key: 'text', label: 'Text', hint: 'Anything typed, e.g. flavour', icon: 'text' },
  { key: 'boolean', label: 'Yes / No', hint: 'e.g. Sugar free', icon: 'toggle' },
];

/** Add or edit one product feature of a category (e.g. Rice > Variety). */
export function FeatureEditor({
  base,
  categoryId,
  categoryName,
  feature,
  onClose,
}: {
  base: string;
  categoryId: string;
  categoryName: string;
  feature: Attribute | null; // null = new
  onClose: (changed: boolean) => void;
}) {
  const editing = !!feature;
  const [label, setLabel] = useState(feature?.label ?? '');
  const [type, setType] = useState<Attribute['type']>(feature?.type ?? 'select');
  const [unit, setUnit] = useState(feature?.unit ?? '');
  const [options, setOptions] = useState<string[]>(feature?.options ?? []);
  const [draft, setDraft] = useState('');
  const [isFilter, setIsFilter] = useState(feature?.is_filter ?? true);
  const [required, setRequired] = useState(feature?.required ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addOption() {
    const v = draft.trim();
    if (!v) return;
    if (options.some((o) => o.toLowerCase() === v.toLowerCase())) {
      setError(`"${v}" is already in the list`);
      return;
    }
    setOptions([...options, v]);
    setDraft('');
    setError(null);
  }

  const ready = label.trim().length > 0 && (type !== 'select' || options.length > 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api(`${base}/attributes/${feature!.id}`, {
          method: 'PUT',
          body: {
            label: label.trim(),
            unit: type === 'number' ? unit.trim() || null : null,
            ...(type === 'select' ? { options } : {}),
            is_filter: isFilter,
            required,
          },
        });
      } else {
        await api(`${base}/categories/${categoryId}/attributes`, {
          method: 'POST',
          body: {
            key: featureKey(label, type === 'number' ? unit : null),
            label: label.trim(),
            type,
            unit: type === 'number' ? unit.trim() || null : null,
            options: type === 'select' ? options : [],
            is_filter: isFilter,
            required,
          },
        });
      }
      onClose(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Pressable onPress={() => onClose(false)} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>{editing ? 'Edit feature' : 'New feature'}</Text>
          <View style={{ width: 52 }} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.help}>
              Products in <Text style={{ fontWeight: '800', color: colors.text }}>{categoryName}</Text> (and its sub-categories) will ask for this.
            </Text>
            <Field label="Feature name" value={label} onChangeText={setLabel} placeholder="e.g. Variety, Pack weight, Flavour" maxLength={80} />

            <Text style={styles.label}>Type {editing ? '(can’t change after creating)' : ''}</Text>
            <View style={styles.types}>
              {TYPES.map((t) => {
                const on = type === t.key;
                return (
                  <Pressable key={t.key} disabled={editing} onPress={() => setType(t.key)} style={[styles.type, on && styles.typeOn, editing && !on && { opacity: 0.4 }]}>
                    <Ionicons name={t.icon} size={18} color={on ? colors.primary : colors.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.typeLabel, on && { color: colors.primary }]}>{t.label}</Text>
                      <Text style={styles.typeHint}>{t.hint}</Text>
                    </View>
                    {on && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </View>

            {type === 'number' && <Field label="Unit (optional)" value={unit} onChangeText={setUnit} placeholder="kg, g, L, ml, pcs" maxLength={20} />}

            {type === 'select' && (
              <View style={{ marginBottom: space.md }}>
                <Text style={styles.label}>Choices</Text>
                <View style={styles.chips}>
                  {options.map((o, i) => (
                    <View key={o} style={styles.chip}>
                      <Text style={styles.chipText}>{o}</Text>
                      <Pressable hitSlop={8} onPress={() => setOptions(options.filter((_, j) => j !== i))} accessibilityLabel={`Remove ${o}`}>
                        <Ionicons name="close-circle" size={16} color={colors.muted} />
                      </Pressable>
                    </View>
                  ))}
                  {!options.length && <Text style={styles.typeHint}>Add at least one choice.</Text>}
                </View>
                <View style={styles.addRow}>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Type a choice, e.g. Basmati"
                    placeholderTextColor={colors.faint}
                    style={styles.addInput}
                    onSubmitEditing={addOption}
                    returnKeyType="done"
                    blurOnSubmit={false}
                  />
                  <Pressable onPress={addOption} style={styles.addBtn} accessibilityLabel="Add choice">
                    <Ionicons name="add" size={20} color="#FFFFFF" />
                  </Pressable>
                </View>
                {editing && <Text style={styles.typeHint}>Removing a choice doesn’t change products that already use it.</Text>}
              </View>
            )}

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Shops can filter by this</Text>
                <Text style={styles.typeHint}>Shows as a filter in the category, e.g. “Basmati only”.</Text>
              </View>
              <Switch value={isFilter} onValueChange={setIsFilter} />
            </View>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Must be filled for every product</Text>
                <Text style={styles.typeHint}>The product form won’t save without it.</Text>
              </View>
              <Switch value={required} onValueChange={setRequired} />
            </View>

            {error && <Banner kind="error" text={error} />}
            <Button title={editing ? 'Save feature' : 'Add feature'} icon="checkmark" onPress={save} loading={busy} disabled={!ready} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cancel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  help: { fontSize: 13, color: colors.muted, marginBottom: space.lg, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  types: { gap: space.sm, marginBottom: space.lg },
  type: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  typeOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  typeLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  typeHint: { fontSize: 12, color: colors.muted, marginTop: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.card, borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingLeft: 12, paddingRight: 8, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  addRow: { flexDirection: 'row', gap: space.sm, marginBottom: 6 },
  addInput: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.md, backgroundColor: colors.card, fontSize: 15, color: colors.text },
  addBtn: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  switchTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
});
