import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Empty, Loading } from '@/components/ui';
import { codeFromQr } from '@/lib/qr';
import { colors, space } from '@/lib/theme';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const router = useRouter();
  const done = useRef(false);

  if (!permission) return <Loading />;
  if (!permission.granted) {
    return (
      <Empty
        icon="camera-outline"
        title="Camera needed"
        text="Allow the camera to scan your distributor's QR code. You can also type the code instead."
        action={<Button title="Allow camera" onPress={requestPermission} />}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={(result) => {
          if (done.current) return;
          const code = codeFromQr(result.data);
          if (!code) return;
          done.current = true;
          router.replace({ pathname: '/add-distributor', params: { code } });
        }}
      />
      <View style={styles.hintBox}>
        <Text style={styles.hint}>Point the camera at the distributor&apos;s QR code</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hintBox: { position: 'absolute', bottom: 48, left: space.xl, right: space.xl, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, padding: space.md },
  hint: { color: colors.card, textAlign: 'center', fontSize: 15 },
});
