import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { ApiError, api } from "./api";
import type { User } from "./types";

interface AuthValue {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>("/auth/me")).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  const setUser = useCallback((user: User | null) => qc.setQueryData(["me"], user), [qc]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("stocksense:unauthorized", onUnauthorized);
    return () => window.removeEventListener("stocksense:unauthorized", onUnauthorized);
  }, [setUser]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    setUser(null);
  }, [qc, setUser]);

  const value = useMemo(
    () => ({ user: me.data ?? null, loading: me.isPending, setUser, logout }),
    [me.data, me.isPending, setUser, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** True when the signed-in user is an inventory manager (the server enforces the same rules). */
export function useIsManager() {
  return useAuth().user?.role === "manager";
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
