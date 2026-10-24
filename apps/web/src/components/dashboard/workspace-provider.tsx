"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, SESSION_EXPIRED_EVENT } from "@/lib/api/client";
import type { Me, Membership } from "@/lib/api/schemas";
import { presetRange, type Preset } from "@/lib/analytics/monthly";

const ORG_KEY = "dw.org";
const PRESET_KEY = "dw.preset";
const THEME_KEY = "dw.theme";

interface Workspace {
  me: Me;
  organization: Membership;
  setOrganizationId: (id: string) => void;
  preset: Preset;
  setPreset: (p: Preset) => void;
  range: { from: string; to: string };
  theme: "light" | "dark";
  toggleTheme: () => void;
  signOut: () => Promise<{ ok: boolean; message?: string }>;
  /** UI convenience only. The API is the authority and re-checks every request. */
  can: (action: "import" | "publish") => boolean;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const ctx = use(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode): the choice simply isn't remembered */
  }
}

type SessionState = { kind: "loading" } | { kind: "ready"; me: Me } | { kind: "error"; error: ApiError };

export function WorkspaceProvider({
  children,
  loading,
  failed,
  noOrganizations,
}: {
  children: React.ReactNode;
  loading: React.ReactNode;
  failed: (error: ApiError, retry: () => void) => React.ReactNode;
  noOrganizations: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [orgId, setOrgId] = useState<string | null>(() => readStorage(ORG_KEY));
  const [preset, setPresetState] = useState<Preset>(() => {
    const p = Number(readStorage(PRESET_KEY));
    return p === 3 || p === 6 ? p : 12;
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => (readStorage(THEME_KEY) === "dark" ? "dark" : "light"));

  // Any 401 anywhere in the workspace means the session is over: go to login, then come back.
  useEffect(() => {
    const onExpired = () => router.replace(`/login?next=${encodeURIComponent(pathname)}&reason=expired`);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [router, pathname]);

  useEffect(() => {
    const controller = new AbortController();
    api.session(controller.signal).then(
      (me) => setSession({ kind: "ready", me }),
      (error: ApiError) => {
        if (error.kind !== "aborted" && error.kind !== "unauthorized") setSession({ kind: "error", error });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    return () => document.documentElement.classList.remove("dark");
  }, [theme]);

  const setOrganizationId = useCallback((id: string) => {
    setOrgId(id);
    writeStorage(ORG_KEY, id);
  }, []);
  const setPreset = useCallback((p: Preset) => {
    setPresetState(p);
    writeStorage(PRESET_KEY, String(p));
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      writeStorage(THEME_KEY, next);
      return next;
    });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
      router.replace("/login?reason=signed-out");
      return { ok: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.messages[0] : "Sign-out failed";
      // The BFF already cleared the cookies; report honestly whether the server confirmed it.
      router.replace(`/login?reason=signed-out-unconfirmed`);
      return { ok: false, message };
    }
  }, [router]);

  const value = useMemo<Workspace | null>(() => {
    if (session.kind !== "ready") return null;
    const memberships = session.me.memberships;
    const organization = memberships.find((m) => m.organizationId === orgId) ?? memberships[0];
    if (!organization) return null;
    return {
      me: session.me,
      organization,
      setOrganizationId,
      preset,
      setPreset,
      range: presetRange(preset, new Date()),
      theme,
      toggleTheme,
      signOut,
      can: (action) => (action === "publish" ? organization.role === "OWNER" : organization.role !== "VIEWER"),
    };
  }, [session, orgId, preset, setOrganizationId, setPreset, theme, toggleTheme, signOut]);

  if (session.kind === "loading") return loading;
  if (session.kind === "error") return failed(session.error, () => setAttempt((a) => a + 1));
  if (!value) return noOrganizations;
  return <WorkspaceContext value={value}>{children}</WorkspaceContext>;
}
