import { createContext, useContext } from 'react';

export const AgentModeContext = createContext(false);
export const useAgentMode = () => useContext(AgentModeContext);
