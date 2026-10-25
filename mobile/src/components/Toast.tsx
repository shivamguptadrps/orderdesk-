import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { radius, space } from '@/lib/theme';

type ToastData = {
  id: number;
  text: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'ok' | 'info' | 'error';
  action?: { label: string; href: string };
};

let next = 1;
export const useToast = create<{ toast: ToastData | null; show: (t: Omit<ToastData, 'id'>) => void; hide: () => void }>()((set) => ({
  toast: null,
  show: (t) => set({ toast: { ...t, id: next++ } }),
  hide: () => set({ toast: null }),
}));

/** Short message near the bottom, like "Added to cart · View cart". One at a time; fades after 2.5 s. */
export function ToastHost() {
  const { toast: shown, hide } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!shown) return;
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 7, tension: 90 }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        if (useToast.getState().toast?.id === shown.id) hide();
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [shown, anim, hide]);

  if (!shown) return null;
  const tone = shown.tone ?? 'ok';
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 132 }]}>
      <Animated.View
        style={[
          styles.toast,
          { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] },
        ]}>
        <Ionicons
          name={shown.icon ?? (tone === 'error' ? 'alert-circle' : 'checkmark-circle')}
          size={20}
          color={tone === 'error' ? '#FF8A80' : tone === 'info' ? '#9EC5FF' : '#5CE08A'}
        />
        <Text style={styles.text} numberOfLines={2}>
          {shown.text}
        </Text>
        {shown.action && (
          <Pressable
            onPress={() => {
              hide();
              router.navigate(shown.action!.href as never);
            }}
            hitSlop={8}>
            <Text style={styles.action}>{shown.action.label}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.lg },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: '#1F2328',
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    maxWidth: 560,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  text: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  action: { color: '#9EC5FF', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
});

