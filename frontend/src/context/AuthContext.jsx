import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, tokens, client } from '../lib/api.js';

const AuthContext = createContext(null);

export const DEMO_PERSONAS = {
  RECRUITER: {
    label: 'Recruiter',
    name: 'Kavya Raman',
    email: 'recruiter@scheduler.dev',
    role: 'RECRUITER',
    desc: 'Manages requests, schedules slots & monitors Control Tower',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  CANDIDATE: {
    label: 'Candidate',
    name: 'Rahul Mehta',
    email: 'rahul.mehta@example.dev',
    role: 'CANDIDATE',
    desc: 'Self-services availability, books slots & joins interview rooms',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  INTERVIEWER: {
    label: 'Interviewer',
    name: 'Ananya Sharma',
    email: 'ananya.sharma@company.dev',
    role: 'INTERVIEWER',
    desc: 'Reviews assignments, accepts/declines & submits feedback',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200',
  },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(tokens.user);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    async function initSession() {
      if (tokens.access && tokens.user) {
        try {
          // Verify session validity with backend
          const me = await api.get('/auth/me');
          tokens.set({ user: me });
          setUser(me);
        } catch {
          // Token expired or invalid
          tokens.clear();
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    }

    initSession();

    const handleExpired = () => {
      tokens.clear();
      setUser(null);
    };
    window.addEventListener('ivs:session-expired', handleExpired);
    return () => window.removeEventListener('ivs:session-expired', handleExpired);
  }, []);

  async function login(email, password = 'Password123') {
    const res = await api.post('/auth/login', { email, password });
    tokens.set(res);
    setUser(res.user);
    return res.user;
  }

  async function register(payload) {
    const res = await api.post('/auth/register', payload);
    tokens.set(res);
    setUser(res.user);
    return res.user;
  }

  async function handleOAuthTokens({ accessToken, refreshToken }) {
    tokens.set({ accessToken, refreshToken });
    const me = await api.get('/auth/me');
    tokens.set({ user: me });
    setUser(me);
    return me;
  }

  async function logout() {
    try {
      if (tokens.refresh) {
        await api.post('/auth/logout', { refreshToken: tokens.refresh });
      }
    } catch {
      // Ignore logout errors
    } finally {
      tokens.clear();
      setUser(null);
    }
  }

  async function switchPersona(roleKey) {
    const persona = DEMO_PERSONAS[roleKey];
    if (!persona) return;
    setSwitching(true);
    try {
      const res = await api.post('/auth/login', {
        email: persona.email,
        password: 'Password123',
      });
      tokens.set(res);
      setUser(res.user);
      return res.user;
    } catch (err) {
      console.error('Failed to switch persona:', err);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        switching,
        login,
        register,
        handleOAuthTokens,
        logout,
        switchPersona,
        currentPersonaKey: Object.keys(DEMO_PERSONAS).find(
          (k) => DEMO_PERSONAS[k].role === user?.role
        ) || 'RECRUITER',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
