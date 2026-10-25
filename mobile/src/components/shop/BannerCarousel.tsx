import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { isHex, shade } from '@/lib/color';
import { mediaUrl } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';
import type { Banner } from '@/lib/types';

const GAP = 12;
const AUTOPLAY_MS = 4500;

/** Sliding offer banners (auto-advances, swipeable). A banner with a category link opens it on tap. */
export function BannerCarousel({ banners, onOpen }: { banners: Banner[]; onOpen: (b: Banner) => void }) {
  const { width } = useWindowDimensions();
  const cardW = Math.min(width - space.lg * 2, 640);
  const cardH = Math.round(cardW / 2.1);
  const scroller = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (banners.length < 2 || paused) return;
    const timer = setInterval(() => {
      const next = (index + 1) % banners.length;
      scroller.current?.scrollTo({ x: next * (cardW + GAP), animated: true });
      setIndex(next);
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [banners.length, cardW, paused, index]);

  if (!banners.length) return null;
  return (
    <View>
      <ScrollView
        ref={scroller}
        horizontal
        decelerationRate="fast"
        snapToInterval={cardW + GAP}
        snapToAlignment="start"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: GAP }}
        onScrollBeginDrag={() => setPaused(true)}
        onMomentumScrollEnd={(e) => {
          setIndex(Math.round(e.nativeEvent.contentOffset.x / (cardW + GAP)));
          setPaused(false);
        }}>
        {banners.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => onOpen(b)}
            disabled={!b.link_category_id}
            accessibilityRole={b.link_category_id ? 'button' : 'image'}
            accessibilityLabel={b.title ?? 'Offer'}
            style={({ pressed }) => [{ width: cardW, height: cardH }, styles.card, pressed && { opacity: 0.94 }]}>
            {b.image_url ? (
              <Image source={{ uri: mediaUrl(b.image_url) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            ) : (
              <TextBanner banner={b} />
            )}
          </Pressable>
        ))}
      </ScrollView>
      {banners.length > 1 && (
        <View style={styles.dots}>
          {banners.map((b, i) => (
            <View key={b.id} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      )}
    </View>
  );
}

function TextBanner({ banner }: { banner: Banner }) {
  const base = isHex(banner.color) ? banner.color : colors.primary;
  return (
    <LinearGradient colors={[shade(base, -0.15), shade(base, 0.2)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.text}>
      <View style={[styles.circle, { width: 180, height: 180, right: -50, top: -60 }]} />
      <View style={[styles.circle, { width: 120, height: 120, right: 40, bottom: -70 }]} />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={styles.title} numberOfLines={2}>
          {banner.title}
        </Text>
        {banner.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {banner.subtitle}
          </Text>
        ) : null}
        {banner.link_category_id ? (
          <View style={styles.cta}>
            <Text style={[styles.ctaText, { color: shade(base, -0.2) }]}>Shop now</Text>
            <Ionicons name="chevron-forward" size={14} color={shade(base, -0.2)} />
          </View>
        ) : null}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.border },
  text: { flex: 1, padding: space.lg, overflow: 'hidden' },
  circle: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', lineHeight: 27, maxWidth: '85%' },
  subtitle: { color: 'rgba(255,255,255,0.92)', fontSize: 14, marginTop: 6, maxWidth: '85%' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    marginTop: space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  ctaText: { fontSize: 13, fontWeight: '800' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { width: 18, backgroundColor: colors.text },
});
