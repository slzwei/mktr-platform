export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

if (!GOOGLE_CLIENT_ID) {
  console.error('[auth] Missing VITE_GOOGLE_CLIENT_ID');
}

// console.log('Google OAuth Client ID loaded:', GOOGLE_CLIENT_ID);
