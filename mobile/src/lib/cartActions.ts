import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { useToast } from '@/components/Toast';
import { firstQty } from '@/components/ui';

import { api, errorText } from './api';
import { cartKey, type Workspace } from './data';
import { feedback } from './feedback';
import { shopParam } from './session';
import type { Cart, CartLine, Unit } from './types';

type Change = { key: string; method: 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown; label?: string };

/** Add / change / remove cart lines from anywhere (product cards, product page, cart), with sound, vibration and a toast. */
export function useCartActions(ws: Workspace) {
  const qc = useQueryClient();
  const query = shopParam(ws.mode, ws.agentShop);
  const m = useMutation({
    mutationFn: (c: Change) => api<Cart>(`/t/${ws.tenantId}${c.path}`, { method: c.method, body: c.body, query }),
    onSuccess: (cart, c) => {
      qc.setQueryData(cartKey(ws), cart);
      void qc.invalidateQueries({ queryKey: ['strip', ws.tenantId, '/cart/suggestions'] });
      const toast = useToast.getState().show;
      if (c.method === 'POST') {
        feedback.add();
        toast({ text: c.label ? `${c.label} added to cart` : 'Added to cart', icon: 'cart', action: { label: 'VIEW CART', href: '/cart' } });
      } else if (c.method === 'DELETE') {
        feedback.remove();
        toast({ text: c.label ? `${c.label} removed` : 'Removed from cart', icon: 'trash', tone: 'info' });
      } else {
        feedback.tick();
      }
    },
    onError: (err) => {
      feedback.error();
      Alert.alert("Couldn't update cart", errorText(err));
    },
  });

  return {
    /** Which item is being saved right now (product or line id), to show a spinner on it. */
    busy: m.isPending ? m.variables?.key : undefined,
    add: (key: string, unit: Pick<Unit, 'id' | 'min_qty' | 'step_qty'>, qty?: number, label?: string) =>
      m.mutate({ key, method: 'POST', path: '/cart/items', body: { unit_id: unit.id, qty: qty ?? firstQty(unit.min_qty, unit.step_qty) }, label }),
    /** Change quantity; going below the minimum removes the line. */
    setQty: (key: string, line: CartLine, qty: number) =>
      qty < firstQty(line.min_qty, line.step_qty)
        ? m.mutate({ key, method: 'DELETE', path: `/cart/items/${line.id}`, label: line.product_name })
        : m.mutate({ key, method: 'PUT', path: `/cart/items/${line.id}`, body: { qty } }),
    remove: (key: string, line: CartLine) => m.mutate({ key, method: 'DELETE', path: `/cart/items/${line.id}`, label: line.product_name }),
  };
}
