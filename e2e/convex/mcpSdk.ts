import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

// Real stateless MCP transport. Each Convex HTTP action owns its server;
// authentication wraps this handler before any SDK method can execute.
export async function handleMcpSdk(request: Request, subject: string) {
  const server = new McpServer({
    name: "private-auth-fixture",
    version: "1.0.0",
  });
  server.registerTool(
    "echo",
    { inputSchema: { text: z.string().min(1) } },
    async ({ text }) => ({
      content: [{ type: "text", text: JSON.stringify({ text, subject }) }],
    })
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse:
      new URL(request.url).searchParams.get("format") === "json",
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
