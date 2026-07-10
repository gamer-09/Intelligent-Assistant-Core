/**
 * Formal tool architecture: every capability the assistant can invoke is
 * registered as a Tool with a name, description, declared inputs/outputs,
 * and a permission level — instead of being an anonymous branch in a switch
 * statement. The pipeline and planner select tools from this registry, and
 * plugins (see plugins.ts) register into the same registry at boot.
 */

export type ToolPermission = "read" | "write" | "external";

export interface ToolSpec {
  name: string;
  description: string;
  capabilities: string[]; // intent names / tags this tool serves
  permission: ToolPermission;
  inputs: string; // human-readable input contract
  outputs: string; // human-readable output contract
  execute: (input: string, context: { sessionId: string }) => Promise<string> | string;
}

const registry = new Map<string, ToolSpec>();

export function registerTool(tool: ToolSpec): void {
  registry.set(tool.name, tool);
}

export function getTool(name: string): ToolSpec | undefined {
  return registry.get(name);
}

export function listTools(): ToolSpec[] {
  return [...registry.values()];
}

/** Find tools whose declared capabilities include the given intent/tag. */
export function toolsForCapability(capability: string): ToolSpec[] {
  return listTools().filter((t) => t.capabilities.includes(capability));
}

export interface InvokePolicy {
  /** Permission levels this caller is allowed to invoke. Defaults to read-only. */
  allow: ToolPermission[];
}

const DEFAULT_POLICY: InvokePolicy = { allow: ["read"] };

/**
 * Enforced entry point for running a tool. Unlike calling `tool.execute()`
 * directly, this checks the tool's declared `permission` against the
 * caller's policy first — `permission` was previously just descriptive
 * metadata with nothing checking it, so a "write"/"external" tool could be
 * invoked with no gate at all. Callers that need write/external access must
 * opt in explicitly via `policy.allow`.
 */
export async function invokeTool(
  name: string,
  input: string,
  context: { sessionId: string },
  policy: InvokePolicy = DEFAULT_POLICY,
): Promise<string> {
  const tool = getTool(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (!policy.allow.includes(tool.permission)) {
    throw new Error(
      `Tool "${name}" requires "${tool.permission}" permission, which is not allowed by the current policy.`,
    );
  }
  return tool.execute(input, context);
}

export function formatToolList(): string {
  if (registry.size === 0) return "No tools registered yet.";
  return listTools()
    .map((t) => `• **${t.name}** (${t.permission}) — ${t.description}`)
    .join("\n");
}
