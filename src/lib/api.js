import { supabase } from './supabase';

// In production on Vercel: relative path '' means requests go to the same domain (/api/batches etc.)
// In development: falls back to localhost Express server
export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');


export async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(options.headers || {});

  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });
}
