import '@/lib/webPolyfills';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { PushHandler } from '@/components/PushHandler';
import { ToastHost } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't retry "not found" / "not allowed"; do retry network hiccups and server errors.
      retry: (count, err) => count < 2 && !(err instanceof ApiError && err.status !== null && err.status < 500),
    },
  },
});

function AuthWatcher() {
  const status = useAuth((s) => s.status);
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signedOut' && segments[0] !== 'login' && segments[0] !== 'health') {
      queryClient.clear();
      router.replace('/login');
    }
  }, [status, segments, router]);
  return null;
}

export default function RootLayout() {
  useEffect(() => {
    useAuth.getState().hydrate();
    useSession.getState().load();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthWatcher />
      <PushHandler />
      <View style={styles.page}>
      <View style={styles.frame}>
      <Stack
        screenOptions={{
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="setup-shop" options={{ title: 'Shop profile' }} />
        <Stack.Screen name="product/[id]" options={{ title: '' }} />
        <Stack.Screen name="category/[id]" options={{ title: '' }} />
        <Stack.Screen name="checkout" options={{ title: 'Review order' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
        <Stack.Screen name="add-distributor" options={{ title: 'Add distributor' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan QR code' }} />
        <Stack.Screen name="choose" options={{ title: 'Ordering from', presentation: 'modal' }} />
        <Stack.Screen name="agent/shops" options={{ title: 'My shops' }} />
        <Stack.Screen name="agent/add-shop" options={{ title: 'Sign up a shop' }} />
        <Stack.Screen name="(manage)" options={{ headerShown: false }} />
        <Stack.Screen name="manage/order/[id]" options={{ title: 'Order' }} />
        <Stack.Screen name="manage/product/[id]" options={{ title: 'Product' }} />
        <Stack.Screen name="manage/shops" options={{ title: 'Shops' }} />
        <Stack.Screen name="manage/team" options={{ title: 'Team' }} />
        <Stack.Screen name="manage/agent/[id]" options={{ title: 'Assign shops' }} />
        <Stack.Screen name="manage/settings" options={{ title: 'Join code & settings' }} />
        <Stack.Screen name="manage/stock" options={{ title: 'Low stock' }} />
        <Stack.Screen name="manage/reports" options={{ title: 'Reports' }} />
        <Stack.Screen name="manage/banners" options={{ title: 'Home banners' }} />
        <Stack.Screen name="manage/categories" options={{ title: 'Categories & features' }} />
        <Stack.Screen name="manage/category/[id]" options={{ title: 'Category' }} />
        <Stack.Screen name="health" options={{ title: 'Server connection' }} />
        <Stack.Screen name="admin/index" options={{ title: 'Platform admin' }} />
        <Stack.Screen name="order-placed" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
      </Stack>
      <ToastHost />
      </View>
      </View>
    </QueryClientProvider>
  );
}

// On a laptop browser, keep the app at a comfortable width in the middle of the screen.
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Platform.OS === 'web' ? '#E9EDF1' : colors.bg },
  frame:
    Platform.OS === 'web'
      ? {
          flex: 1,
          width: '100%',
          maxWidth: 1080,
          alignSelf: 'center',
          backgroundColor: colors.bg,
          borderLeftWidth: StyleSheet.hairlineWidth,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          overflow: 'hidden',
        }
      : { flex: 1 },
});
