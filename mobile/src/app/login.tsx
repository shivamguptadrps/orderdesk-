import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radius, space } from '@/lib/theme';

type OtpSent = { sent: boolean; expires_in_seconds: number; dev_code: string | null };
type Tokens = { access_token: string; refresh_token: string };

const RESEND_AFTER = 30;

export default function Login() {
  const router = useRouter();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const phoneOk = /^[6-9]\d{9}$/.test(phone);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<OtpSent>('/auth/otp/request', { method: 'POST', body: { phone }, auth: false });
      setDevCode(res.dev_code);
      setStep('code');
      setCode('');
      setResendIn(RESEND_AFTER);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<Tokens>('/auth/otp/verify', { method: 'POST', body: { phone, code: value }, auth: false });
      qc.clear();
      await useAuth.getState().signIn(res.access_token, res.refresh_token);
      router.replace('/');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.card }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>OrderDesk</Text>
          <Text style={styles.tagline}>Order from your distributors in one app</Text>

          {step === 'phone' ? (
            <>
              <Text style={styles.label}>Mobile number</Text>
              <View style={styles.phoneRow}>
                <Text style={styles.prefix}>+91</Text>
                <TextInput
                  value={phone}
                  onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="number-pad"
                  placeholder="98765 43210"
                  placeholderTextColor={colors.faint}
                  style={styles.phoneInput}
                  maxLength={10}
                  autoFocus
                  textContentType="telephoneNumber"
                />
              </View>
              {error && <Banner kind="error" text={error} />}
              <Button title="Send code on WhatsApp" onPress={sendCode} loading={busy} disabled={!phoneOk} icon="logo-whatsapp" />
            </>
          ) : (
            <>
              <Text style={styles.label}>Enter the 6-digit code sent to +91 {phone}</Text>
              {devCode && <Banner kind="info" text={`Test mode: your code is ${devCode}`} />}
              <TextInput
                value={code}
                onChangeText={(t) => {
                  const digits = t.replace(/\D/g, '').slice(0, 6);
                  setCode(digits);
                  if (digits.length === 6) verify(digits);
                }}
                keyboardType="number-pad"
                placeholder="••••••"
                placeholderTextColor={colors.faint}
                style={styles.codeInput}
                maxLength={6}
                autoFocus
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
              />
              {error && <Banner kind="error" text={error} />}
              <Button title="Verify" onPress={() => verify()} loading={busy} disabled={code.length !== 6} />
              <View style={styles.links}>
                <Pressable onPress={() => setStep('phone')}>
                  <Text style={styles.link}>Change number</Text>
                </Pressable>
                <Pressable onPress={sendCode} disabled={resendIn > 0 || busy}>
                  <Text style={[styles.link, resendIn > 0 && { color: colors.faint }]}>
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: 72 },
  brand: { fontSize: 34, fontWeight: '800', color: colors.primary },
  tagline: { fontSize: 15, color: colors.muted, marginTop: 4, marginBottom: 40 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: space.sm },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginBottom: space.lg,
  },
  prefix: { fontSize: 18, paddingHorizontal: space.md, color: colors.muted, borderRightWidth: 1, borderRightColor: colors.border },
  phoneInput: { flex: 1, fontSize: 20, paddingHorizontal: space.md, minHeight: 52, color: colors.text, letterSpacing: 1 },
  codeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    fontSize: 28,
    letterSpacing: 10,
    textAlign: 'center',
    minHeight: 60,
    marginBottom: space.lg,
    color: colors.text,
  },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.lg },
  link: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
