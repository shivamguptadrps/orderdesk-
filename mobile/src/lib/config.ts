// Backend address comes from .env.local (EXPO_PUBLIC_API_URL). On a phone this must be the
// laptop's Wi-Fi IP, e.g. http://192.168.29.110:8000 - "localhost" would mean the phone itself.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
