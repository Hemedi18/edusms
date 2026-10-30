import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, tokenStore } from "../api/client";
import type { AuthSessionResponse, UserProfile } from "../types/api";

interface LoginInput {
  email: string;
  password: string;
  mfa_code?: string;
  device_label?: string;
}

interface RegisterInput {
  email: string;
  full_name: string;
  organization?: string;
  password: string;
  timezone?: string;
  default_country_code?: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<UserProfile>;
  register: (input: RegisterInput) => Promise<UserProfile>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<UserProfile | null>;
  updateProfile: (patch: Partial<UserProfile>) => Promise<UserProfile>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => Boolean(tokenStore.getAccess()));

  const refreshProfile = useCallback(async (): Promise<UserProfile | null> => {
    if (!tokenStore.getAccess()) {
      setUser(null);
      setIsLoading(false);
      return null;
    }
    try {
      const profile = await api.get<UserProfile>("/auth/me/");
      setUser(profile);
      return profile;
    } catch {
      tokenStore.clear();
      setUser(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tokenStore.getAccess()) {
      void refreshProfile();
    } else {
      setIsLoading(false);
    }

    const handleCleared = () => {
      setUser(null);
    };
    window.addEventListener("edusms:auth-cleared", handleCleared);
    return () => window.removeEventListener("edusms:auth-cleared", handleCleared);
  }, [refreshProfile]);

  const login = useCallback(async (input: LoginInput): Promise<UserProfile> => {
    const res = await api.post<AuthSessionResponse>("/auth/login/", input, { skipAuth: true });
    tokenStore.setTokens({
      access: res.access,
      refresh: res.refresh,
      session_id: res.session_id,
    });
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (input: RegisterInput): Promise<UserProfile> => {
    const res = await api.post<AuthSessionResponse>("/auth/register/", input, { skipAuth: true });
    tokenStore.setTokens({
      access: res.access,
      refresh: res.refresh,
      session_id: res.session_id,
    });
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const refresh = tokenStore.getRefresh();
    try {
      if (tokenStore.getAccess()) {
        await api.post("/auth/logout/", { refresh });
      }
    } catch {
      // ignore logout error if token expired
    } finally {
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  const updateProfile = useCallback(async (patch: Partial<UserProfile>): Promise<UserProfile> => {
    const updated = await api.patch<UserProfile>("/auth/me/", patch);
    setUser(updated);
    return updated;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      refreshProfile,
      updateProfile,
    }),
    [user, isLoading, login, register, logout, refreshProfile, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
