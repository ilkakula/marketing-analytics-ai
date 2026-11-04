import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, tokenStore } from "./api";
import type { AuthResult } from "./types";

interface AuthCtx {
  authed: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (v: { email: string; password: string; name: string; workspaceName: string }) => Promise<void>;
  logout: () => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => !!tokenStore.get());
  const qc = useQueryClient();

  const logout = useCallback(() => {
    tokenStore.clear();
    qc.clear(); // the cache belongs to the user; it must not leak into the next session
    setAuthed(false);
  }, [qc]);

  useEffect(() => {
    window.addEventListener("spendlens:unauthorized", logout);
    return () => window.removeEventListener("spendlens:unauthorized", logout);
  }, [logout]);

  const accept = (r: AuthResult) => { qc.clear(); tokenStore.set(r.token); setAuthed(true); };

  const value = useMemo<AuthCtx>(() => ({
    authed, logout,
    login: async (email, password) => accept(await api<AuthResult>("/api/auth/login", { json: { email, password } })),
    register: async (v) => accept(await api<AuthResult>("/api/auth/register", { json: v })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [authed, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth van AuthProvider-a");
  return c;
}
