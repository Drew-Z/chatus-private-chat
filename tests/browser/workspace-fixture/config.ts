const configuredPort = process.env.CHATUS_WORKSPACE_FIXTURE_PORT;
const parsedPort = configuredPort === undefined ? 4178 : Number(configuredPort);

if (!Number.isSafeInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
  throw new Error("CHATUS_WORKSPACE_FIXTURE_PORT must be an integer between 1 and 65535");
}

export const workspaceFixturePort = parsedPort;
export const workspaceFixtureBaseURL = `http://127.0.0.1:${workspaceFixturePort}`;
