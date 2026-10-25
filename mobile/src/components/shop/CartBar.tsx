import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useCart, type Workspace } from '@/lib/data';
import { inr } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';

/** Floating "3 items · ₹2,400 — View cart" bar, shown while the cart has something in it. */
export function CartBar({ ws }: { ws: Workspace }) {
  const router = useRouter();
  const cart = useCart(ws);
  const c = cart.data;
  const count = c?.item_count ?? 0;
  const [bump] = useState(() => new Animated.Value(1));
  const last = useRef(count);
  useEffect(() => {
    // A little bounce whenever the number of items goes up.
    if (count > last.current) {
      bump.setValue(0.92);
      Animated.spring(bump, { toValue: 1, friction: 3, tension: 160, useNativeDriver: true }).start();
    }
    last.current = count;
  }, [count, bump]);
  if (!c || !c.items.length) return null;
  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { transform: [{ scale: bump }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View cart, ${c.item_count} items, ${inr(c.total)}`}
        onPress={() => router.navigate('/cart')}
        style={({ pressed }) => [styles.bar, pressed && { opacity: 0.92 }]}>
        <View style={styles.icon}>
          <Ionicons name="cart" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.count}>
            {c.item_count} item{c.item_count === 1 ? '' : 's'}
          </Text>
          <Text style={styles.total}>{inr(c.total)}</Text>
        </View>
        <Text style={styles.cta}>View cart</Text>
        <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.md },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  icon: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  count: { color: '#DCE8FF', fontSize: 12, fontWeight: '600' },
  total: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  cta: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
