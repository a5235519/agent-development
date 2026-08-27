import { createAgentWorkbenchServer } from './agent-workbench-server.mjs';

const port = Number(process.env.AGENT_API_PORT || 8788);
const { server } = await createAgentWorkbenchServer();
server.listen(port, '127.0.0.1', () => {
  console.log(`Agent Workbench API listening on http://127.0.0.1:${port}`);
});
