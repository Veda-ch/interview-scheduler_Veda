/**
 * API client.
 *
 * Responsibilities beyond "call fetch":
 *  - attaches the access token
 *  - transparently refreshes an expired session ONCE and replays the request,
 *    queueing concurrent calls so a token refresh does not stampede
 *  - normalises the backend error envelope into an Error with `.code` and
 *    `.details`, so components can render a specific message instead of
 *    "something went wrong"
 */
import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || '/api';

const STORAGE = {
  access: 'ivs.accessToken',
  refresh: 'ivs.refreshToken',
  user: 'ivs.user',
};

export const tokens = {
  get access() {
    return localStorage.getItem(STORAGE.access);
  },
  get refresh() {
    return localStorage.getItem(STORAGE.refresh);
  },
  set({ accessToken, refreshToken, user }) {
    if (accessToken) localStorage.setItem(STORAGE.access, accessToken);
    if (refreshToken) localStorage.setItem(STORAGE.refresh, refreshToken);
    if (user) localStorage.setItem(STORAGE.user, JSON.stringify(user));
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.user) || 'null');
    } catch {
      return null;
    }
  },
  clear() {
    Object.values(STORAGE).forEach((k) => localStorage.removeItem(k));
  },
};

export const client = axios.create({ baseURL: BASE, timeout: 45000 });

client.interceptors.request.use((config) => {
  const token = tokens.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing = null;
const listeners = [];

function onRefreshed(token) {
  listeners.splice(0).forEach((cb) => cb(token));
}

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;
    const payload = error.response?.data?.error;

    // --- 401: try exactly one silent refresh, then give up and sign out.
    if (status === 401 && !original.__retried && tokens.refresh && !original.url?.includes('/auth/')) {
      original.__retried = true;

      if (!refreshing) {
        refreshing = axios
          .post(`${BASE}/auth/refresh`, { refreshToken: tokens.refresh })
          .then(({ data }) => {
            tokens.set(data);
            onRefreshed(data.accessToken);
            return data.accessToken;
          })
          .catch((err) => {
            tokens.clear();
            onRefreshed(null);
            window.dispatchEvent(new CustomEvent('ivs:session-expired'));
            throw err;
          })
          .finally(() => {
            refreshing = null;
          });
      }

      const newToken = await new Promise((resolve) => {
        listeners.push(resolve);
        refreshing.catch(() => {});
      });

      if (!newToken) return Promise.reject(normalise(error));
      original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
      return client(original);
    }

    return Promise.reject(normalise(error));
  }
);

function normalise(error) {
  const payload = error.response?.data?.error;
  const err = new Error(
    payload?.message ||
      (error.code === 'ECONNABORTED'
        ? 'The request timed out. The server may be busy.'
        : error.message === 'Network Error'
          ? 'Cannot reach the API. Is the backend running on port 4000?'
          : 'Unexpected error')
  );
  err.code = payload?.code || error.code || 'UNKNOWN';
  err.status = error.response?.status;
  err.details = payload?.details;
  err.incidentId = payload?.incidentId;
  return err;
}

const unwrap = (p) => p.then((r) => r.data);

/** Thin verb helpers so components read declaratively. */
export const api = {
  get: (url, config) => unwrap(client.get(url, config)),
  post: (url, body, config) => unwrap(client.post(url, body, config)),
  put: (url, body, config) => unwrap(client.put(url, body, config)),
  del: (url, config) => unwrap(client.delete(url, config)),

  /** POST with an idempotency key - use for anything that creates or moves an interview. */
  postOnce: (url, body) =>
    unwrap(
      client.post(url, body, {
        headers: { 'Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
      })
    ),

  upload: (url, file, field = 'resume') => {
    const form = new FormData();
    form.append(field, file);
    return unwrap(client.post(url, form, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
};

export default api;
