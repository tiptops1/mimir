import type { PrismaClient } from "@prisma/client";

// Runtime consumer of PromptTemplate (events.md §4) — prompts are tenant
// config, versions are immutable, AgentAction/QuarantineItem pin key+version.
// First consumer: the S11 health classifier. Rendering is strict (Zod-at-the-
// boundary spirit): missing declared variables or undeclared {{placeholders}}
// in the body are hard errors, unlike the forgiving outreach renderer.

export interface ActivePrompt {
  key: string;
  version: number;
  body: string;
  variables: string[];
}

/** Load the active version of a prompt template. Throws if none exists. */
export async function getActivePrompt(
  prisma: PrismaClient,
  key: string,
): Promise<ActivePrompt> {
  const row = await prisma.promptTemplate.findFirst({
    where: { key, active: true },
    orderBy: { version: "desc" },
    select: { key: true, version: true, body: true, variables: true },
  });
  if (!row) {
    throw new Error(`No active PromptTemplate for key "${key}" — is the tenant config seeded?`);
  }
  return row;
}

/**
 * Substitute {{var}} placeholders. Fails on a declared variable that wasn't
 * supplied and on a placeholder in the body that isn't declared — a prompt
 * config edit can't silently produce a broken system prompt.
 */
export function renderPrompt(prompt: ActivePrompt, vars: Record<string, string>): string {
  for (const declared of prompt.variables) {
    if (!(declared in vars)) {
      throw new Error(`Prompt "${prompt.key}" v${prompt.version}: missing variable "${declared}"`);
    }
  }
  return prompt.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => {
    if (!prompt.variables.includes(name)) {
      throw new Error(
        `Prompt "${prompt.key}" v${prompt.version}: undeclared placeholder "{{${name}}}"`,
      );
    }
    return vars[name];
  });
}
