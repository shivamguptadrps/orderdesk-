import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { API_URL } from './config';

const ACCESS = 'auth.access';
const REFRESH = 'auth.refresh';

type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  accessToken: string | null;
  refreshToken: string | null;
  hydrate: () => Promise<void>;
  signIn: (access: string, refresh: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Swap the refresh token for new tokens. Returns false if the session is over. */
  refresh: () => Promise<boolean>;
};

let refreshing: Promise<boolean> | null = null;

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'loading',
  accessToken: null,
  refreshToken: null,

  hydrate: async () => {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS),
      SecureStore.getItemAsync(REFRESH),
    ]);
    set({ accessToken, refreshToken, status: accessToken ? 'signedIn' : 'signedOut' });
  },

  signIn: async (access, refresh) => {
    await Promise.all([SecureStore.setItemAsync(ACCESS, access), SecureStore.setItemAsync(REFRESH, refresh)]);
    set({ accessToken: access, refreshToken: refresh, status: 'signedIn' });
  },

  signOut: async () => {
    const token = get().refreshToken;
    set({ accessToken: null, refreshToken: null, status: 'signedOut' });
    await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]);
    if (token) {
      fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token }),
      }).catch(() => undefined);
    }
  },

  refresh: () => {
    // Many requests may hit 401 at once; only one refresh call goes out.
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const token = get().refreshToken;
      if (!token) return false;
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: token }),
        });
        if (!res.ok) return false;
        const body = await res.json();
        await get().signIn(body.access_token, body.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  },
}));
