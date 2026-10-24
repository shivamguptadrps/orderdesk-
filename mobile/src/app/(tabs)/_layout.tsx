import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';

import { useCart, useWorkspace } from '@/lib/data';
import { colors } from '@/lib/theme';

export default function TabsLayout() {
  const ws = useWorkspace();
  const cart = useCart(ws.current);
  const count = cart.data?.item_count ?? 0;
  // Distributor tools have their own tabs.
  if (ws.current?.mode === 'manage') return <Redirect href="/dashboard" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerTitleStyle: { fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Shop',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="storefront-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          tabBarBadge: count > 0 ? count : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="cart-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
