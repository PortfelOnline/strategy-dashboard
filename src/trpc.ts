import { createTRPCReact } from "@trpc/react-query";
import type { BotsRouter } from "../server/router";

export const trpc = createTRPCReact<BotsRouter>();
