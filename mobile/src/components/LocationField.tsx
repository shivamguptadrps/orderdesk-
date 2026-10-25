import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, space } from '@/lib/theme';

export type Pin = { lat: number; lng: number };
export type FoundAddress = { address?: string; city?: string; pincode?: string };

export function mapsUrl(lat: number | string, lng: number | string) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * "Use my current location": saves the shop's map pin (stand at the shop when you tap it),
 * and offers the address the phone finds so empty fields can be filled in.
 */
export function LocationField({
  value,
  onChange,
  onAddress,
}: {
  value: Pin | null;
  onChange: (pin: Pin | null) => void;
  onAddress?: (found: FoundAddress) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function locate() {
    setBusy(true);
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Location permission is off. Allow it in phone settings, or skip this.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const pin = { lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) };
      onChange(pin);
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: pin.lat, longitude: pin.lng });
        if (place && onAddress) {
          const street = [place.name, place.street, place.district].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
          onAddress({ address: street || undefined, city: place.city ?? place.subregion ?? undefined, pincode: place.postalCode ?? undefined });
        }
      } catch {
        // address lookup is a bonus; the pin is what matters
      }
    } catch {
      setError("Couldn't get your location. Turn on GPS and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: value ? colors.okSoft : colors.primarySoft }]}>
          <Ionicons name={value ? 'location' : 'location-outline'} size={20} color={value ? colors.ok : colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{value ? 'Shop location saved' : 'Shop location on map'}</Text>
          <Text style={styles.sub}>
            {value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : 'Helps the delivery person reach you. Tap while standing at the shop.'}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={locate} disabled={busy} style={[styles.btn, styles.btnMain]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="navigate" size={16} color="#FFFFFF" />}
          <Text style={styles.btnMainText}>{value ? 'Update location' : 'Use my current location'}</Text>
        </Pressable>
        {value && (
          <Pressable onPress={() => Linking.openURL(mapsUrl(value.lat, value.lng))} style={styles.btn} accessibilityRole="link">
            <Ionicons name="map-outline" size={16} color={colors.primary} />
            <Text style={styles.btnText}>View</Text>
          </Pressable>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, backgroundColor: colors.card, marginBottom: space.md },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary },
  btnMain: { flex: 1, justifyContent: 'center', backgroundColor: colors.primary },
  btnMainText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  btnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  error: { color: colors.error, fontSize: 12, marginTop: space.sm },
});
