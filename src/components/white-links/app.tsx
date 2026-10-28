"use client";

import React, { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Header, Footer } from "./chrome";
import { I18nProvider } from "./i18n-context";
import { useHashRoute, Spinner } from "./shared";
import { api, ApiError, type Me } from "./api";
import { Landing } from "./landing";
import { Register } from "./register";
import { Login } from "./login";
import { Dashboard, GuessPage, RevealPage } from "./dashboard";
import { MessagesPage } from "./messages";
import { AdminPage } from "./admin";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 },
  },
});

// /api/auth/me returns 401 when logged out — treat it as a settled result,
// never an error (an erroring query would flip loading state on every
// observer mount and cause mount/unmount oscillation).
async function fetchMe(): Promise<{ user: Me | null }> {
  try {
    return await api<{ user: Me }>("/api/auth/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { user: null };
    throw e;
  }
}

function AuthMe({ children }: { children: (me: Me | null, loading: boolean) => React.ReactNode }) {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 30000,
  });
  return <>{children(meQuery.data?.user ?? null, meQuery.isLoading)}</>;
}

function Routes() {
  const { path, navigate } = useHashRoute();
  const route = path.replace(/^\/white-links/, "").replace(/^\//, "") || "";

  return (
    <AuthMe>
      {(me, loading) => {
        if (loading) {
          return (
            <div className="flex min-h-[60vh] items-center justify-center">
              <Spinner />
            </div>
          );
        }

        // Auth guards for private views
        const memberViews = ["dashboard", "messages", "guess", "reveal"];
        if (memberViews.includes(route) && !me) {
          return <Login onSuccess={() => navigate("/white-links/dashboard")} onRegister={() => navigate("/white-links/register")} />;
        }
        if (route === "admin" && !me) {
          return <Login onSuccess={() => navigate("/white-links/admin")} onRegister={() => navigate("/white-links/register")} />;
        }

        switch (route) {
          case "":
            return <Landing me={me} />;
          case "register":
            return <Register onDone={() => navigate("/white-links/dashboard")} />;
          case "login":
            return me ? (
              <RedirectToDashboard />
            ) : (
              <Login onSuccess={() => navigate("/white-links/dashboard")} onRegister={() => navigate("/white-links/register")} />
            );
          case "dashboard":
            return me ? <Dashboard me={me} /> : <Login onSuccess={() => navigate("/white-links/dashboard")} onRegister={() => navigate("/white-links/register")} />;
          case "messages":
            return <MessagesPage />;
          case "guess":
            return <GuessPage />;
          case "reveal":
            return <RevealPage />;
          case "admin":
            return me?.role === "ADMIN" ? <AdminPage /> : <NotFoundAdmin />;
          default:
            return <Landing me={me} />;
        }
      }}
    </AuthMe>
  );
}

function RedirectToDashboard() {
  useEffect(() => {
    window.location.hash = "/white-links/dashboard";
  }, []);
  return <Spinner />;
}

function NotFoundAdmin() {
  return (
    <main className="flex flex-1 items-center justify-center py-24">
      <div className="wl-card max-w-sm p-10 text-center">
        <p className="font-display text-4xl">Accès réservé</p>
        <p className="mt-2 text-sm text-black/60">Cette console est réservée aux administrateurs du club.</p>
        <button onClick={() => (window.location.hash = "/")} className="mt-4 text-sm underline">
          ← Accueil
        </button>
      </div>
    </main>
  );
}

function Shell() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <HeaderWithMe />
      <Routes />
      <Footer />
    </div>
  );
}

function HeaderWithMe() {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 30000,
  });
  return <Header me={meQuery.data?.user ?? null} />;
}

export default function WhiteLinksApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <Shell />
      </I18nProvider>
    </QueryClientProvider>
  );
}
