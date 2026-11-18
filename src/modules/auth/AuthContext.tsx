import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../../lib/firebase';
import { apiFetch } from '../../services/api';

export interface AuthProfile {
  id: string;
  uid: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  countryIso2: string;
  cityName: string;
  preferredLang: string;
  activeRole: string;
}

interface AuthContextValue {
  firebaseUser: User | null;
  profile: AuthProfile | null;
  roles: string[];
  activeRole: string;
  adminCountryIso2s: string[];
  loading: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  switchRole: (role: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [activeRole, setActiveRole] = useState<string>('CLIENT');
  const [adminCountryIso2s, setAdminCountryIso2s] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) {
      setProfile(null);
      setRoles([]);
      setAdminCountryIso2s([]);
      return;
    }
    try {
      const data = await apiFetch('/api/auth/me');
      setProfile(data.profile);
      setRoles(data.roles || ['CLIENT']);
      setActiveRole(data.activeRole || 'CLIENT');
      setAdminCountryIso2s(data.adminCountryIso2s || []);
      setAuthError(null);
    } catch (err: any) {
      setAuthError(err.message);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await refreshProfile();
      } else {
        setProfile(null);
        setRoles([]);
        setAdminCountryIso2s([]);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [refreshProfile]);

  const signIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
      await refreshProfile();
    } catch (err: any) {
      setAuthError(err.message || 'Sign-in cancelled');
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
    setRoles([]);
    setActiveRole('CLIENT');
    setAdminCountryIso2s([]);
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cacheKeys = await window.caches.keys();
        await Promise.all(
          cacheKeys
            .filter((k) => k.includes('kazi-api'))
            .map((k) => window.caches.delete(k))
        );
      } catch {
        // ignore cache cleanup error
      }
    }
  };

  const switchRole = async (role: string) => {
    const data = await apiFetch('/api/auth/active-role', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    setActiveRole(data.activeRole);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        roles,
        activeRole,
        adminCountryIso2s,
        loading,
        authError,
        signIn,
        signOut,
        refreshProfile,
        switchRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
