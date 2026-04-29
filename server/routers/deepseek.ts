import { router, protectedProcedure } from '../_core/trpc';
import http from 'http';

const AGENT_HOST = '167.86.116.15';
const AGENT_PORT = 8766;

function agentFetch(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: AGENT_HOST, port: AGENT_PORT, path, timeout: 10_000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export const deepseekRouter = router({
  health: protectedProcedure.query(async () => {
    try {
      const raw = await agentFetch('/health');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { status: 'unreachable', error: 'Agent not reachable' };
    }
  }),

  services: protectedProcedure.query(async () => {
    try {
      const raw = await agentFetch('/services');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }),

  tasks: protectedProcedure.query(async () => {
    try {
      const raw = await agentFetch('/tasks');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { error: 'Cannot fetch tasks' };
    }
  }),

  sessions: protectedProcedure.query(async () => {
    try {
      const raw = await agentFetch('/sessions');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return [];
    }
  }),

  permissions: protectedProcedure.query(async () => {
    try {
      const raw = await agentFetch('/permissions');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }),

  bgTasks: protectedProcedure.query(async () => {
    try {
      const raw = await agentFetch('/bg-tasks');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return [];
    }
  }),
});
