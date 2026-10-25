import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { firstQty } from '@/components/ui';

import { api, errorText } from './api';
import { cartKey, type Workspace } from './data';
import { shopParam } from './session';
import type { Cart, CartLine, Unit } from './types';

type Change = { key: string; method: 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown };

/** Add / change / remove cart lines from anywhere (product cards, product page, cart). */
export function useCartActions(ws: Workspace) {
  const qc = useQueryClient();
  const query = shopParam(ws.mode, ws.agentShop);
  const m = useMutation({
    mutationFn: (c: Change) => api<Cart>(`/t/${ws.tenantId}${c.path}`, { method: c.method, body: c.body, query }),
    onSuccess: (cart) => {
      qc.setQueryData(cartKey(ws), cart);
      void qc.invalidateQueries({ queryKey: ['strip', ws.tenantId, '/cart/suggestions'] });
    },
    onError: (err) => Alert.alert("Couldn't update cart", errorText(err)),
  });

  return {
    /** Which item is being saved right now (product or line id), to show a spinner on it. */
    busy: m.isPending ? m.variables?.key : undefined,
    add: (key: string, unit: Pick<Unit, 'id' | 'min_qty' | 'step_qty'>, qty?: number) =>
      m.mutate({ key, method: 'POST', path: '/cart/items', body: { unit_id: unit.id, qty: qty ?? firstQty(unit.min_qty, unit.step_qty) } }),
    /** Change quantity; going below the minimum removes the line. */
    setQty: (key: string, line: CartLine, qty: number) =>
      qty < firstQty(line.min_qty, line.step_qty)
        ? m.mutate({ key, method: 'DELETE', path: `/cart/items/${line.id}` })
        : m.mutate({ key, method: 'PUT', path: `/cart/items/${line.id}`, body: { qty } }),
    remove: (key: string, line: CartLine) => m.mutate({ key, method: 'DELETE', path: `/cart/items/${line.id}` }),
  };
}
