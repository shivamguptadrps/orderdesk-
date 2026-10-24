import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import { useWorkspace } from './data';
import type { Dashboard, FlatCategory, ManageProduct, Member, TenantInfo } from './types';

/** Distributor tools: the distributor being managed and the user's role there. */
export function useManage() {
  const ws = useWorkspace();
  const current = ws.current?.mode === 'manage' ? ws.current : null;
  return {
    ws,
    current,
    tenantId: current?.tenantId,
    base: current ? `/t/${current.tenantId}` : '',
    isOwner: current?.role === 'owner',
  };
}

export function useDashboard(tenantId?: string) {
  return useQuery({
    queryKey: ['dashboard', tenantId],
    queryFn: () => api<Dashboard>(`/t/${tenantId}/dashboard`),
    enabled: !!tenantId,
  });
}

export function useTenant(tenantId?: string) {
  return useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => api<TenantInfo>(`/t/${tenantId}`),
    enabled: !!tenantId,
  });
}

export function useCategoriesFlat(tenantId?: string) {
  return useQuery({
    queryKey: ['mcategories', tenantId],
    queryFn: () => api<FlatCategory[]>(`/t/${tenantId}/categories`),
    enabled: !!tenantId,
    staleTime: 5 * 60_000,
  });
}

export function useMembers(tenantId?: string, role?: 'agent' | 'staff') {
  return useQuery({
    queryKey: ['members', tenantId, role ?? 'all'],
    queryFn: () => api<Member[]>(`/t/${tenantId}/members`, { query: { role } }),
    enabled: !!tenantId,
  });
}

/** Refresh everything a distributor action can change. */
export function useRefreshManage() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['dashboard', 'morders', 'order', 'mproducts', 'mproduct', 'mshops', 'members', 'tenant', 'ledger', 'products', 'product'].map(
        (key) => qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

/** '9 Bag (30) · 270 pcs' - stock in the main pack and in pieces. */
export function stockText(p: ManageProduct): string {
  const unit = p.units.find((u) => u.is_default) ?? p.units[0];
  if (!unit || unit.pieces_per_unit === 1) return `${p.stock_pieces} pcs`;
  return `${Math.floor(p.stock_pieces / unit.pieces_per_unit)} ${unit.name} · ${p.stock_pieces} pcs`;
}
