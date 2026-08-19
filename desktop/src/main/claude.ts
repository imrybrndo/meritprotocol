/**
 * The operator agent on the Anthropic API.
 *
 * The tools, the system prompt and the approval gate live in agent-tools.ts,
 * shared with the OpenRouter adapter. What is specific to this file is how the
 * loop is driven: the SDK's tool runner, with adaptive thinking and streaming.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { getSecret } from "./vault";
import { SYSTEM, toolSpecs, type AgentEvents } from "./agent-tools";

const MODEL = "claude-opus-5";

type Turn = { role: "user" | "assistant"; content: unknown };

const history: Turn[] = [];

export function resetConversation(): void {
  history.length = 0;
}

export async function sendMessage(text: string, events: AgentEvents): Promise<void> {
  const apiKey = getSecret("anthropicApiKey");
  if (!apiKey) {
    throw new Error("No Anthropic API key configured. Add one in Settings to use chat.");
  }

  const client = new Anthropic({ apiKey });
  history.push({ role: "user", content: text });

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    tools: toolSpecs(events).map((spec) =>
      betaTool({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.parameters as never,
        run: (input: unknown) => spec.run(input),
      }),
    ),
    messages: history as never,
    stream: true,
  });

  for await (const stream of runner) {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        events.onText(event.delta.text);
      }
    }
  }

  // Keep the assistant's final answer only. Intermediate tool_use/tool_result
  // pairs are dropped together, never half — a history carrying a tool_use with
  // no matching result is rejected on the next turn.
  const final = await runner.done();
  history.push({ role: "assistant", content: final.content });
}
