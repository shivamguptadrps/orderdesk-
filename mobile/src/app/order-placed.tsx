import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CallDistributor } from '@/components/shop/CallDistributor';
import { feedback } from '@/lib/feedback';
import { inr } from '@/lib/format';
import { radius, space } from '@/lib/theme';

const CONFETTI_COLORS = ['#FFFFFF', '#FFD33D', '#9EF0B5', '#79C0FF', '#FF9BB3', '#FFB86B'];
const PIECES = 26;

/** Full-screen "Order placed!" with a springing tick, rings, confetti, chime and vibration. */
export default function OrderPlacedScreen() {
  const { id, tenant, no, total, saved, from } = useLocalSearchParams<{
    id: string;
    tenant: string;
    no: string;
    total: string;
    saved?: string;
    from?: string;
  }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [tick] = useState(() => new Animated.Value(0));
  const [ring] = useState(() => new Animated.Value(0));
  const [text] = useState(() => new Animated.Value(0));
  const [fall] = useState(() => new Animated.Value(0));
  const [pieces] = useState(() =>
    Array.from({ length: PIECES }, (_, i) => ({
      x: Math.random(),
      drift: (Math.random() - 0.5) * 120,
      delay: Math.random() * 0.35,
      size: 6 + Math.random() * 8,
      round: i % 3 === 0,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      spin: (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 360),
    })),
  );

  useEffect(() => {
    setStatusBarStyle('light');
    feedback.success();
    Animated.sequence([
      Animated.spring(tick, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }),
      Animated.timing(text, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
    Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }), { iterations: 3 }).start();
    Animated.timing(fall, { toValue: 1, duration: 2600, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    return () => setStatusBarStyle('dark');
  }, [tick, ring, text, fall]);

  const savedAmount = Number(saved ?? 0);
  const fade = { opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] };

  return (
    <LinearGradient colors={['#137333', '#1A7F37', '#2EA043']} style={{ flex: 1 }}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: p.x * width,
            top: -20,
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            borderRadius: p.round ? p.size / 2 : 2,
            backgroundColor: p.color,
            opacity: fall.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-40 - p.delay * 300, height * 0.75] }) },
              { translateX: fall.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] }) },
            ],
          }}
        />
      ))}

      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={styles.tickWrap}>
            {[0, 1].map((k) => (
              <Animated.View
                key={k}
                style={[
                  styles.ring,
                  {
                    opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45 - k * 0.15, 0] }),
                    transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9 + k * 0.5] }) }],
                  },
                ]}
              />
            ))}
            <Animated.View style={[styles.circle, { transform: [{ scale: tick }, { rotate: tick.interpolate({ inputRange: [0, 1], outputRange: ['-30deg', '0deg'] }) }] }]}>
              <Ionicons name="checkmark" size={84} color="#1A7F37" />
            </Animated.View>
          </View>

          <Animated.View style={[{ alignItems: 'center' }, fade]}>
            <Text style={styles.title}>Order placed!</Text>
            <Text style={styles.sub}>
              Order #{no} · {inr(Number(total ?? 0))}
            </Text>
            {savedAmount > 0 && (
              <View style={styles.savedPill}>
                <Ionicons name="pricetag" size={14} color="#137333" />
                <Text style={styles.savedText}>You saved {inr(savedAmount)} on MRP</Text>
              </View>
            )}
            <Text style={styles.note}>{from ? `${from} will confirm it soon.` : 'Your distributor will confirm it soon.'} We&apos;ll let you know when it&apos;s approved and on the way.</Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.actions, fade]}>
          <CallDistributor tenantId={tenant} name={from} onGreen />
          <Pressable
            onPress={() => {
              router.dismissAll();
              router.push({ pathname: '/order/[id]', params: { id, tenant } });
            }}
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }]}
            accessibilityRole="button">
            <Ionicons name="receipt-outline" size={18} color="#137333" />
            <Text style={styles.primaryText}>Track order</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              router.dismissAll();
              router.navigate('/home');
            }}
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.8 }]}
            accessibilityRole="button">
            <Text style={styles.secondaryText}>Continue shopping</Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const CIRCLE = 132;
const styles = StyleSheet.create({
  safe: { flex: 1, padding: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tickWrap: { width: CIRCLE, height: CIRCLE, alignItems: 'center', justifyContent: 'center', marginBottom: space.xl },
  ring: { position: 'absolute', width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, borderWidth: 3, borderColor: '#FFFFFF' },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  title: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.92)', fontSize: 18, fontWeight: '700', marginTop: space.sm },
  savedPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#DAFBE1', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginTop: space.md },
  savedText: { color: '#137333', fontWeight: '800', fontSize: 14 },
  note: { color: 'rgba(255,255,255,0.85)', fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: space.lg, maxWidth: 320 },
  actions: { gap: space.md, width: '100%', maxWidth: 480, alignSelf: 'center' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: radius.md, height: 54 },
  primaryText: { color: '#137333', fontSize: 17, fontWeight: '900' },
  secondary: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, height: 50, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  secondaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
