import { useContext, useId, useLayoutEffect, type RefObject } from 'react';
import { WebMcpContext } from './context';
import type { ToolScope } from './runtime';

/** Registration follows the actual React control, including article and dialog lifetimes. */
export function useWebMcpSurface(owner: RefObject<HTMLElement>, scope: ToolScope, enabled = true) {
  const context = useContext(WebMcpContext);
  const runtime = context?.runtime;
  const active = context?.active === true;
  const key = useId();
  const signature = JSON.stringify(scope);
  useLayoutEffect(() => {
    if (!runtime || !active || !enabled) return;
    return runtime.mount(key, () => owner.current, JSON.parse(signature) as ToolScope);
  }, [runtime, active, enabled, key, owner, signature]);
}
