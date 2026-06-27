import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  model?: string;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  // Groq: disable <think> blocks on reasoning models (qwen3, deepseek-r1).
  // "none" (recommended for content tasks) | "default" | "low" | "medium" | "high"
  reasoningEffort?: "none" | "default" | "low" | "medium" | "high";
  reasoning_effort?: "none" | "default" | "low" | "medium" | "high";
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const resolveApiUrl = () =>
  ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
    : "https://forge.manus.im/v1/chat/completions";

const assertApiKey = () => {
  if (!ENV.forgeApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

// Извлекает текст из normalizeMessage-контента (строка или массив частей).
function partsToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p: any) => (typeof p === 'string' ? p : (p?.type === 'text' ? p.text : ''))).join('');
  }
  return '';
}

// Вызов Code Assist моста (Gemini) в формате generateContent. Возвращает текст или null (блок/пусто).
async function invokeGeminiBridge(payload: Record<string, unknown>): Promise<string | null> {
  const base = (process.env.GEMINI_BRIDGE_URL || 'http://localhost:4400/genai').replace(/\/$/, '');
  const model = String(payload.model ?? process.env.GEMINI_BRIDGE_MODEL ?? 'gemini-3.5-flash');
  const msgs = ((payload.messages as any[]) || []);
  const sys = msgs.filter(m => m.role === 'system').map(m => partsToText(m.content)).join('\n').trim();
  const contents = msgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: partsToText(m.content) }] }));
  if (contents.length === 0) return null;
  const wantJson = String((payload.response_format as any)?.type || '').includes('json');
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: (payload.max_tokens as number) || 4096,
      ...(wantJson ? { responseMimeType: 'application/json' } : {}),
    },
    ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
  };
  const r = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': 'bridge' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`bridge ${r.status}`);
  const j: any = await r.json();
  const cand = j?.candidates?.[0];
  const fr = cand?.finishReason;
  if (fr === 'PROHIBITED_CONTENT' || fr === 'SAFETY' || fr === 'BLOCKLIST') return null;
  const text = (cand?.content?.parts || []).map((p: any) => p?.text || '').join('').trim();
  return text || null;
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  assertApiKey();

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const payload: Record<string, unknown> = {
    model: params.model ?? (process.env.LLM_DEFAULT_MODEL ?? "llama-3.3-70b-versatile"),
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  payload.max_tokens = params.maxTokens ?? params.max_tokens ?? 4096;

  // Auto-disable reasoning for Qwen3 / DeepSeek-R1 unless explicitly overridden
  // (reasoning models consume half of max_tokens on <think> blocks → truncated articles)
  const modelStr = String(payload.model ?? '').toLowerCase();
  const isReasoningModel = /qwen3|qwen-3|deepseek-r1/.test(modelStr);
  const explicitEffort = params.reasoningEffort ?? params.reasoning_effort;
  if (explicitEffort) {
    payload.reasoning_effort = explicitEffort;
  } else if (isReasoningModel) {
    payload.reasoning_effort = "none";
  }

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  // ── Gemini-bridge backend (Code Assist via ViralCraft мост, Antigravity-квота, обход лимитов) ──
  // Транслирует OpenAI messages → Gemini generateContent, зовёт мост, мапит ответ обратно.
  // Tool-calls и strict json_schema оставляем на Groq (мост их не транслирует). Автофолбэк на Groq
  // при ошибке/PROHIBITED_CONTENT/пустом ответе — редкие safety-блоки Gemini не уронят генерацию.
  const rfType = (payload.response_format as any)?.type;
  if (process.env.LLM_BACKEND === 'gemini-bridge' && !payload.tools && rfType !== 'json_schema') {
    try {
      const text = await invokeGeminiBridge(payload);
      if (text) {
        return {
          id: 'gemini-bridge', created: 0, model: String(payload.model ?? 'gemini'),
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        } as InvokeResult;
      }
      console.warn('[LLM] gemini-bridge: пусто/safety-блок — фолбэк на Groq');
    } catch (e: any) {
      console.warn('[LLM] gemini-bridge ошибка:', e?.message?.slice(0, 120), '— фолбэк на Groq');
    }
  }

  const MAX_RETRIES = 8;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(resolveApiUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return (await response.json()) as InvokeResult;
    }

    const errorText = await response.text();

    // Rate limit — parse retry-after and wait
    // Groq returns formats like "try again in 30s" or "try again in 6m9.792s"
    if (response.status === 429 && attempt < MAX_RETRIES - 1) {
      let waitMs = 60000; // default 60s
      try {
        const match = errorText.match(/try again in (?:(\d+)m)?(?:([\d.]+)s)?/i);
        if (match && (match[1] || match[2])) {
          const mins = parseFloat(match[1] || '0');
          const secs = parseFloat(match[2] || '0');
          waitMs = Math.ceil((mins * 60 + secs) * 1000) + 3000;
        }
      } catch {}
      console.warn(`[LLM] 429 rate limit — waiting ${Math.round(waitMs/1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    throw new Error(`LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  throw new Error('LLM invoke failed: max retries exceeded');
}
