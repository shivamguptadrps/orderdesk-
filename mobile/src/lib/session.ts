import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const KEY = 'session.v1';

export type Mode = 'shop' | 'agent';

type Saved = {
  tenantId: string | null;
  mode: Mode;
  agentShop: { id: string; name: string } | null;
};

type SessionState = Saved & {
  loaded: boolean;
  load: () => Promise<void>;
  /** Shop mode: order for my own shop from this distributor. */
  chooseShopMode: (tenantId: string) => void;
  /** Agent mode for this distributor; the shop is picked separately. */
  chooseAgentMode: (tenantId: string) => void;
  pickAgentShop: (shop: { id: string; name: string } | null) => void;
  reset: () => void;
};

const EMPTY: Saved = { tenantId: null, mode: 'shop', agentShop: null };

function save(state: Saved) {
  SecureStore.setItemAsync(KEY, JSON.stringify(state)).catch(() => undefined);
}

export const useSession = create<SessionState>()((set, get) => {
  const update = (patch: Partial<Saved>) => {
    set(patch);
    const { tenantId, mode, agentShop } = get();
    save({ tenantId, mode, agentShop });
  };
  return {
    ...EMPTY,
    loaded: false,
    load: async () => {
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        set({ ...(raw ? (JSON.parse(raw) as Saved) : EMPTY), loaded: true });
      } catch {
        set({ ...EMPTY, loaded: true });
      }
    },
    chooseShopMode: (tenantId) => update({ tenantId, mode: 'shop', agentShop: null }),
    chooseAgentMode: (tenantId) =>
      update({ tenantId, mode: 'agent', agentShop: get().mode === 'agent' && get().tenantId === tenantId ? get().agentShop : null }),
    pickAgentShop: (agentShop) => update({ agentShop }),
    reset: () => update(EMPTY),
  };
});

/** Query params every cart/order call needs: agents say which shop they order for. */
export function shopParam(mode: Mode, agentShop: { id: string } | null) {
  return mode === 'agent' && agentShop ? { shop_id: agentShop.id } : {};
}
