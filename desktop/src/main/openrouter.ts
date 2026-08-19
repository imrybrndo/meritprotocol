/**
 * The operator agent on OpenRouter.
 *
 * OpenRouter is a gateway: one key, one endpoint, hundreds of models. Its API
 * is OpenAI-shaped, so this file owns the translation — the tool specs, the
 * system prompt and the approval gate come from agent-tools.ts unchanged, which
 * is what keeps commit_decision behaving identically on either provider.
 *
 * The loop is written out rather than taken from an SDK: request, stream the
 * deltas, and when the model asks for tools, run them and go round again.
 */

import { getSecret, getAgentConfig } from "./vault";
import { SYSTEM, toolSpecs, type AgentEvents, type ToolSpec } from "./agent-tools";

const BASE = "https://openrouter.ai/api/v1";

/** Sent so the operator's usage is attributable on the OpenRouter dashboard. */
const ATTRIBUTION = {
  "HTTP-Referer": "https://merit.protocol",
  "X-Title": "MERIT Console",
};

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

const history: Message[] = [];

export function resetConversation(): void {
  history.length = 0;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  promptPrice: number | null;
  completionPrice: number | null;
  supportsTools: boolean;
}

/**
 * The catalogue, for the model picker in Settings. Public — no key needed, so
 * the operator can browse before they have pasted one.
 *
 * Only models that can call tools are returned: the agent's entire job is
 * commit_decision, and a model without tool support would chat pleasantly while
 * being unable to seal anything.
 */
export async function listModels(): Promise<OpenRouterModel[]> {
  const response = await fetch(`${BASE}/models`, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`OpenRouter refused the model list with ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      supported_parameters?: string[];
    }>;
  };

  const price = (value?: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return (payload.data ?? [])
    .filter((model) => model.supported_parameters?.includes("tools"))
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      contextLength: model.context_length ?? null,
      promptPrice: price(model.pricing?.prompt),
      completionPrice: price(model.pricing?.completion),
      supportsTools: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function asOpenAiTools(specs: ToolSpec[]) {
  return specs.map((spec) => ({
    type: "function" as const,
    function: { name: spec.name, description: spec.description, parameters: spec.parameters },
  }));
}

/**
 * One request, streamed. Returns the assistant text and any tool calls it asked
 * for; the caller decides whether to run them and come back.
 */
async function turn(
  apiKey: string,
  model: string,
  specs: ToolSpec[],
  events: AgentEvents,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...ATTRIBUTION,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: SYSTEM }, ...history],
      tools: asOpenAiTools(specs),
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    let message = `OpenRouter returned ${response.status}.`;
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      if (detail) message = detail.slice(0, 300);
    }
    if (response.status === 401) {
      message = "OpenRouter rejected that API key. Check it in Settings.";
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  // Tool calls arrive in fragments keyed by index, name first, then the
  // arguments a few characters at a time.
  const calls = new Map<number, ToolCall>();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;

      let event: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try {
        event = JSON.parse(payload);
      } catch {
        // OpenRouter interleaves ": OPENROUTER PROCESSING" keep-alives.
        continue;
      }

      const delta = event.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        text += delta.content;
        events.onText(delta.content);
      }

      for (const fragment of delta.tool_calls ?? []) {
        const existing = calls.get(fragment.index) ?? { id: "", name: "", arguments: "" };
        calls.set(fragment.index, {
          id: fragment.id ?? existing.id,
          name: fragment.function?.name ?? existing.name,
          arguments: existing.arguments + (fragment.function?.arguments ?? ""),
        });
      }
    }
  }

  return { text, toolCalls: [...calls.values()].filter((call) => call.name) };
}

export async function sendMessage(text: string, events: AgentEvents): Promise<void> {
  const apiKey = getSecret("openrouterApiKey");
  if (!apiKey) {
    throw new Error("No OpenRouter API key configured. Add one in Settings to use chat.");
  }

  const model = getAgentConfig().openrouterModel;
  if (!model) {
    throw new Error("No OpenRouter model chosen. Pick one in Settings to use chat.");
  }

  const specs = toolSpecs(events);
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  history.push({ role: "user", content: text });

  // A ceiling on tool rounds. Without one, a model that keeps re-calling a tool
  // loops until the operator's credit runs out rather than until it is done.
  for (let round = 0; round < 8; round += 1) {
    const result = await turn(apiKey, model, specs, events);

    if (result.toolCalls.length === 0) {
      history.push({ role: "assistant", content: result.text });
      return;
    }

    history.push({
      role: "assistant",
      content: result.text || null,
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const call of result.toolCalls) {
      const spec = byName.get(call.name);
      let output: string;

      if (!spec) {
        output = JSON.stringify({ error: `No tool named ${call.name}.` });
      } else {
        try {
          // Always parse: providers differ in how they escape argument JSON.
          output = await spec.run(JSON.parse(call.arguments || "{}"));
        } catch (error) {
          output = JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      history.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }

  throw new Error("The model kept calling tools without finishing. Stopped after 8 rounds.");
}
