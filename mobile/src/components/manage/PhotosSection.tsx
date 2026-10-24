import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { api, errorText, uploadImage } from '@/lib/api';
import { mediaUrl } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';
import type { ManageProduct } from '@/lib/types';

const MAX_PHOTOS = 10;

export function PhotosSection({ product, base, onChanged }: { product: ManageProduct; base: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const url = `${base}/products/${product.id}/images`;

  async function add(source: 'camera' | 'gallery') {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera not allowed', 'Allow camera access in Settings to take product photos.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.length) return;
      setBusy(true);
      const asset = result.assets[0];
      await uploadImage(url, { uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType });
      onChanged();
    } catch (err) {
      Alert.alert("Couldn't add photo", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function remove(index: number) {
    Alert.alert('Remove photo?', index === 0 ? 'This is the main photo; the next one becomes main.' : '', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(true);
            await api(`${url}/${index}`, { method: 'DELETE' });
            onChanged();
          } catch (err) {
            Alert.alert("Couldn't remove photo", errorText(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <View>
      {product.thumbnails.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.sm }}>
          {product.thumbnails.map((thumb, i) => (
            <View key={thumb} style={styles.photo}>
              <Image source={{ uri: mediaUrl(thumb) }} style={StyleSheet.absoluteFill} contentFit="cover" />
              {i === 0 && <Text style={styles.main}>Main</Text>}
              <Pressable onPress={() => remove(i)} style={styles.remove} hitSlop={8} accessibilityLabel="Remove photo">
                <Ionicons name="close" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.muted}>No photos yet. Shops order faster when they can see the product.</Text>
      )}
      {product.images.length < MAX_PHOTOS && (
        <View style={styles.row}>
          <Button title="Camera" icon="camera-outline" variant="secondary" loading={busy} onPress={() => add('camera')} style={{ flex: 1 }} />
          <Button title="Gallery" icon="images-outline" variant="secondary" disabled={busy} onPress={() => add('gallery')} style={{ flex: 1 }} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  photo: { width: 96, height: 96, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.bg },
  main: { position: 'absolute', left: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.6)', color: '#FFFFFF', fontSize: 10, paddingHorizontal: 4, borderRadius: 4 },
  remove: { position: 'absolute', right: 4, top: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.muted, fontSize: 14 },
});
