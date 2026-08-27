import { httpAgentWorkbenchApi } from './httpAgentWorkbenchApi.js';
import { mockAgentWorkbenchApi } from './mockAgentWorkbenchApi.js';

export const agentWorkbenchApi = import.meta.env.VITE_AGENT_API === 'http'
  ? httpAgentWorkbenchApi
  : mockAgentWorkbenchApi;
