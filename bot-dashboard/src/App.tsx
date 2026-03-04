import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { Toaster } from "sonner";
import { trpc } from "./trpc";
import Bots from "./pages/Bots";

export default function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc" })],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Bots />
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
