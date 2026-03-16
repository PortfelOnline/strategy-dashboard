import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState, useEffect } from "react";
import { Toaster } from "sonner";
import { trpc } from "./trpc";
import Bots from "./pages/Bots";
import Login from "./pages/Login";

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc" })],
    })
  );

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => setAuthenticated(d.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) return null; // Loading

  if (!authenticated) {
    return <Login onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Bots />
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
