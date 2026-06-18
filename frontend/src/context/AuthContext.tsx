import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { authApi, type RegisterPayload } from "../services/api";
import type { User, AuthResponse } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  // Returns the register response (e.g. { status: "verification_sent", ... });
  // registration no longer logs the user in — they must verify their email first.
  register: (payload: RegisterPayload) => Promise<unknown>;
  // Apply a token+user pair (used by email verification + OAuth callback).
  applyAuth: (data: AuthResponse) => void;
  setSessionToken: (token: string) => void;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token")
  );
  const [loading, setLoading] = useState(true);

  const applyAuth = useCallback((data: AuthResponse) => {
    localStorage.setItem("token", data.access_token);
    setToken(data.access_token);
    setUser(data.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = (await authApi.login(email, password)) as AuthResponse;
      applyAuth(data);
    },
    [applyAuth]
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      return authApi.register(payload);
    },
    []
  );

  const refreshUser = useCallback(async () => {
    const data = (await authApi.getMe()) as User;
    setUser(data);
  }, []);

  // Store a bare JWT then hydrate the user from /me (OAuth callback path).
  const setSessionToken = useCallback((t: string) => {
    localStorage.setItem("token", t);
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .getMe()
      .then((data) => setUser(data as User))
      .catch(() => {
        localStorage.removeItem("token");
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        user, token, loading,
        login, register, applyAuth, setSessionToken, refreshUser, logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
