import { detectAvailableAgents } from "./detect-agents.js";
import { isCommandAvailable } from "./is-command-available.js";
import { CLI_AGENT_BINARIES, type CliAgentId } from "./launch-agent.js";

// CLI agents we can launch: detected as installed by `agent-install`
// (filesystem config dir) AND with their launch binary on PATH (since we
// hand the prompt to that CLI). `agent-install` has no command-availability
// check, so `isCommandAvailable` covers the launchability half. Returned in
// `CLI_AGENT_BINARIES` order so callers get a stable agent ordering.
export const detectLaunchableAgents = async (): Promise<CliAgentId[]> => {
  const detected = new Set(await detectAvailableAgents());
  return (Object.keys(CLI_AGENT_BINARIES) as CliAgentId[]).filter(
    (agentId) => detected.has(agentId) && isCommandAvailable(CLI_AGENT_BINARIES[agentId]),
  );
};
