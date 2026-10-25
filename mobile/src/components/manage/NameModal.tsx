import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Banner, Button } from '@/components/ui';
import { colors, radius, space } from '@/lib/theme';

/** Small pop-up asking for a name (new category, rename). `onSave` returns an error text to show, or null. */
export function NameModal({
  title,
  hint,
  initial = '',
  placeholder,
  saveLabel = 'Save',
  onSave,
  onClose,
}: {
  title: string;
  hint?: string;
  initial?: string;
  placeholder?: string;
  saveLabel?: string;
  onSave: (name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const problem = await onSave(name.trim());
    setBusy(false);
    if (problem) setError(problem);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={placeholder}
            placeholderTextColor={colors.faint}
            autoFocus
            maxLength={80}
            style={styles.input}
            onSubmitEditing={() => name.trim() && save()}
          />
          {error && <Banner kind="error" text={error} />}
          <View style={styles.row}>
            <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button title={saveLabel} onPress={save} loading={busy} disabled={!name.trim() || name.trim() === initial} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: space.xl },
  sheet: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.xl, maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  hint: { fontSize: 13, color: colors.muted, marginTop: 4 },
  input: { marginTop: space.lg, marginBottom: space.md, minHeight: 48, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: space.md, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
});
