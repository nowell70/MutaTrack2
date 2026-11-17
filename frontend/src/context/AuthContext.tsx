import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User } from '../types';
import { clearLegacyAuthStorage, setCurrentUser, setStorageUser } from '../services/storage';
import { clearToken, getToken, setToken, UNAUTHORIZED_EVENT } from '../services/api';

export interface AuthResult {
  success: boolean;
  error?: string;
}

interface AuthContextType {
  user: User | null;
  /** true selama sesi tersimpan masih diperiksa ke server (saat halaman pertama dimuat) */
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (email: string, password: string, nama: string) => Promise<AuthResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const extractError = (data: any, fallback: string): string => {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') return detail[0].msg;
  return fallback;
};

type AuthCall = { ok: true; token: string; user: User } | { ok: false; error: string };

const callAuth = async (path: 'login' | 'register', body: Record<string, string>): Promise<AuthCall> => {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'Tidak dapat terhubung ke server. Pastikan backend berjalan.' };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: extractError(data, `Server menolak permintaan (HTTP ${res.status}).`) };
  }
  if (!data?.token || !data?.user) {
    return { ok: false, error: 'Respons server tidak valid.' };
  }
  return { ok: true, token: data.token, user: data.user as User };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const startSession = useCallback((token: string, u: User) => {
    setToken(token);
    setStorageUser(u.id); // data lokal dipisah per pengguna; harus sebelum setUser
    setCurrentUser(u);
    setUser(u);
  }, []);

  const endSession = useCallback(() => {
    clearToken();
    setStorageUser(null);
    setCurrentUser(null);
    setUser(null);
  }, []);

  // Pulihkan sesi: token tersimpan harus divalidasi server. Tidak ada lagi login otomatis.
  useEffect(() => {
    let cancelled = false;
    clearLegacyAuthStorage();

    (async () => {
      if (!getToken()) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data?.user) {
            setStorageUser(data.user.id);
            setCurrentUser(data.user);
            setUser(data.user as User);
          }
        } else if (res.status === 401) {
          clearToken(); // token kedaluwarsa atau tidak valid
        }
        // status lain (mis. backend sedang mati): token dipertahankan, pengguna tetap melihat halaman login
      } catch {
        /* backend tidak terjangkau */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Server menolak token (kedaluwarsa/dicabut) di tengah pemakaian: keluarkan pengguna.
  useEffect(() => {
    const onUnauthorized = () => endSession();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [endSession]);

  const login = async (email: string, password: string): Promise<AuthResult> => {
    const r = await callAuth('login', { email: email.trim(), password });
    if (!r.ok) return { success: false, error: r.error };
    startSession(r.token, r.user);
    return { success: true };
  };

  const register = async (email: string, password: string, nama: string): Promise<AuthResult> => {
    const r = await callAuth('register', { email: email.trim(), password, nama: nama.trim() });
    if (!r.ok) return { success: false, error: r.error };
    startSession(r.token, r.user);
    return { success: true };
  };

  const logout = () => endSession();

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
