import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Empty } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMe } from '@/lib/data';
import { useSession } from '@/lib/session';
import { space } from '@/lib/theme';

/** Owner/staff accounts without a shop: their tools arrive in M6. */
export default function DistributorSoon() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const names = (me.data?.memberships ?? []).map((m) => m.tenant_name).join(', ');
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Empty
        icon="construct-outline"
        title="Distributor tools are coming"
        text={`You manage ${names || 'a distributor'}. Approving orders, managing products and shops from the app is the next milestone (M6). Until then, use the API page at /docs on the server.`}
        action={
          <View style={{ gap: space.md }}>
            <Button title="I also run a shop" variant="secondary" onPress={() => router.push('/setup-shop')} />
            <Button
              title="Log out"
              variant="danger"
              onPress={async () => {
                useSession.getState().reset();
                qc.clear();
                await useAuth.getState().signOut();
              }}
            />
          </View>
        }
      />
    </SafeAreaView>
  );
}
