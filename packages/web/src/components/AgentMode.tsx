import { useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import { agentModeEnabled } from '../browserPreferences';
import { AgentModeContext } from '../hooks/useAgentMode';
import { useBrowserPreferences } from '../hooks/useBrowserPreferences';

const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};
export function AgentMode({ children }: { children: ReactNode }) {
  const preferences = useBrowserPreferences();
  const search = useSyncExternalStore(subscribe, () => location.search);
  const active = agentModeEnabled(search, preferences.values.agentMode);
  useLayoutEffect(() => {
    document.documentElement.dataset.agentMode = String(active);
    return () => {
      delete document.documentElement.dataset.agentMode;
    };
  }, [active]);
  return <AgentModeContext.Provider value={active}>{children}</AgentModeContext.Provider>;
}
