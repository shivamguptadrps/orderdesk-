import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import { useAuth } from './auth';
import { Mode, shopParam, useSession } from './session';
import type { AgentShop, Cart, Me, MyDistributor } from './types';

export function useMe() {
  const signedIn = useAuth((s) => s.status === 'signedIn');
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), enabled: signedIn });
}

export function useMyDistributors(enabled = true) {
  return useQuery({
    queryKey: ['myDistributors'],
    queryFn: () => api<MyDistributor[]>('/shops/me/distributors'),
    enabled,
  });
}

export type WorkspaceOption = {
  tenantId: string;
  name: string;
  mode: Mode;
  brandColor: string | null;
  logoUrl?: string | null;
  role?: 'owner' | 'staff' | 'agent';
};

export type Workspace = {
  tenantId: string;
  name: string;
  mode: Mode;
  brandColor: string | null;
  logoUrl?: string | null;
  role?: 'owner' | 'staff' | 'agent';
  /** Agent mode: the shop being ordered for (null until picked). */
  agentShop: { id: string; name: string } | null;
};

/**
 * Where the user is ordering right now: which distributor, as a shop or as an agent.
 * Uses the saved choice when it's still valid, otherwise a sensible default (nothing is written).
 */
export function useWorkspace() {
  const me = useMe();
  const hasShop = !!me.data?.shop;
  const dists = useMyDistributors(hasShop);
  const session = useSession();

  const shopOptions: WorkspaceOption[] = (dists.data ?? [])
    .filter((d) => d.status === 'active')
    .map((d) => ({ tenantId: d.tenant_id, name: d.name, mode: 'shop', brandColor: d.brand_color, logoUrl: d.logo_url }));
  const agentOptions: WorkspaceOption[] = (me.data?.memberships ?? [])
    .filter((m) => m.role === 'agent')
    .map((m) => ({ tenantId: m.tenant_id, name: m.tenant_name, mode: 'agent', brandColor: null, role: 'agent' }));
  const manageOptions: WorkspaceOption[] = (me.data?.memberships ?? [])
    .filter((m) => m.role === 'owner' || m.role === 'staff')
    .map((m) => ({ tenantId: m.tenant_id, name: m.tenant_name, mode: 'manage', brandColor: null, role: m.role }));
  const options = [...shopOptions, ...agentOptions, ...manageOptions];

  const saved = options.find((o) => o.tenantId === session.tenantId && o.mode === session.mode);
  const chosen = saved ?? options[0];
  const current: Workspace | null = chosen
    ? { ...chosen, agentShop: chosen.mode === 'agent' && saved ? session.agentShop : null }
    : null;

  return {
    me,
    distributors: dists,
    current,
    shopOptions,
    agentOptions,
    manageOptions,
    loading: me.isLoading || (hasShop && dists.isLoading) || !session.loaded,
  };
}

/** Query params for cart/order calls (agents add shop_id). */
export function useShopParam(ws: Workspace | null) {
  return ws ? shopParam(ws.mode, ws.agentShop) : {};
}

export function cartKey(ws: Workspace | null) {
  return ['cart', ws?.tenantId, ws?.mode, ws?.agentShop?.id ?? null];
}

export function useCart(ws: Workspace | null) {
  const ready = !!ws && (ws.mode === 'shop' || !!ws.agentShop);
  return useQuery({
    queryKey: cartKey(ws),
    queryFn: () => api<Cart>(`/t/${ws!.tenantId}/cart`, { query: shopParam(ws!.mode, ws!.agentShop) }),
    enabled: ready,
  });
}

export function useAgentShops(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['agentShops', tenantId],
    queryFn: () => api<AgentShop[]>(`/t/${tenantId}/agent/shops`),
    enabled: !!tenantId,
  });
}

/** After anything that changes orders or the cart. */
export function useRefreshOrders() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['orders'] }),
      qc.invalidateQueries({ queryKey: ['order'] }),
      qc.invalidateQueries({ queryKey: ['cart'] }),
      qc.invalidateQueries({ queryKey: ['agentShops'] }),
    ]);
}
