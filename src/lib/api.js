import { supabase } from './supabase';

// In production: set VITE_API_URL to your Railway backend URL in Vercel env vars
// In development: falls back to local server
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';


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
