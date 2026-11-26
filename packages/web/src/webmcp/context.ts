import { createContext } from 'react';
import type { WebMcpRuntime, RuntimeState } from './runtime';

export const WebMcpContext = createContext<{
  runtime: WebMcpRuntime;
  active: boolean;
  state: RuntimeState;
  retry: () => void;
} | null>(null);
