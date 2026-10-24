import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';

import { Loading } from '@/components/ui';
import { useDashboard, useManage } from '@/lib/manage';
import { colors } from '@/lib/theme';

/** Distributor tools: tabs for owner and staff. */
export default function ManageLayout() {
  const { ws, current, tenantId } = useManage();
  const dash = useDashboard(tenantId);
  if (ws.loading) return <Loading />;
  if (!current) return <Redirect href="/home" />;
  const pending = dash.data?.pending_orders ?? 0;
  const waiting = dash.data?.shops_waiting ?? 0;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerTitleStyle: { fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: current.name,
          tabBarLabel: 'Today',
          tabBarIcon: ({ color, size }) => <Ionicons name="speedometer-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          title: 'Orders',
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Products',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarBadge: waiting > 0 ? waiting : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
