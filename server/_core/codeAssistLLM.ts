import type {
  InvokeParams,
  InvokeResult,
  Message,
  MessageContent,
} from "./llm";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CodeAssistInvokerOptions = {
  bridgeUrl?: string;
  fetchImpl?: FetchLike;
};

export function isCodeAssistQuotaError(error: unknown): boolean {
  let text = "";
  try { text = JSON.stringify(error); } catch { text = String(error); }
  return /RESOURCE_EXHAUSTED|codeassist\s+429|HTTP\s+429/i.test(text);
}

function resolveRequestedModel(requestedModel: string | undefined): string {
  const defaultModel = process.env.CODE_ASSIST_ARTICLE_MODEL || "gemini-auto-agent";
  if (!requestedModel) return defaultModel;
  return /gemini[^/]*(?:auto|pro|flash)|(?:auto|pro|flash)[^/]*gemini/i.test(requestedModel)
    ? requestedModel
    : defaultModel;
}

function contentPartToText(part: MessageContent): string {
  if (typeof part === "string") return part;
  if (part.type === "text") return part.text;
  if (part.type === "image_url") return `[Изображение: ${part.image_url.url}]`;
  return `[Файл: ${part.file_url.url}]`;
}

function messageToText(message: Message): string {
  const parts = Array.isArray(message.content) ? message.content : [message.content];
  return parts.map(contentPartToText).join("\n");
}

function resolveBridgeBase(explicitUrl?: string): string {
  const configured = explicitUrl
    || process.env.GEMINI_BRIDGE_URL
    || "http://viralcraft:3000";
  return configured.replace(/\/genai\/?$/, "").replace(/\/$/, "");
}

function responseFormatConfig(params: InvokeParams): Record<string, unknown> {
  const format = params.responseFormat || params.response_format;
  const schema = params.outputSchema || params.output_schema;

  if (format?.type === "json_schema") {
    return {
      responseMimeType: "application/json",
      responseSchema: format.json_schema.schema,
    };
  }
  if (schema) {
    return {
      responseMimeType: "application/json",
      responseSchema: schema.schema,
    };
  }
  if (format?.type === "json_object") {
    return { responseMimeType: "application/json" };
  }
  return {};
}

export function createCodeAssistInvoker({
  bridgeUrl,
  fetchImpl = fetch,
}: CodeAssistInvokerOptions = {}) {
  return async function invokeCodeAssist(params: InvokeParams): Promise<InvokeResult> {
    const systemText = params.messages
      .filter(message => message.role === "system")
      .map(messageToText)
      .join("\n\n");
    const contents = params.messages
      .filter(message => message.role !== "system")
      .map(message => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: messageToText(message) }],
      }));

    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: systemText || "Продолжай." }] });
    }

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: params.maxTokens ?? params.max_tokens ?? 4096,
      thinkingConfig: { thinkingBudget: 256 },
      ...responseFormatConfig(params),
    };
    const body: Record<string, unknown> = { contents, generationConfig };
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }
    if (params.tools?.length) {
      body.tools = [{
        functionDeclarations: params.tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      }];
    }

    const requestedModel = resolveRequestedModel(params.model);
    const url = `${resolveBridgeBase(bridgeUrl)}/genai/v1beta/models/${requestedModel}:generateContent`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    });
    const responseText = await response.text();

    if (!response.ok) {
      let parsed: any = {};
      try { parsed = JSON.parse(responseText); } catch {}
      const payload = parsed?.error || parsed;
      const quotaExhausted = isCodeAssistQuotaError({
        code: response.status,
        status: payload?.status,
        message: payload?.message || responseText,
      });
      const error = Object.assign(
        new Error(payload?.message || `Code Assist HTTP ${response.status}`),
        {
          code: quotaExhausted ? 429 : response.status,
          status: quotaExhausted ? "RESOURCE_EXHAUSTED" : payload?.status,
        },
      );
      throw error;
    }

    const data = JSON.parse(responseText);
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((part: { text?: string }) => part.text ?? "").join("").trim();
    if (!content) throw new Error("Code Assist returned an empty response");

    return {
      id: data?.responseId || `codeassist-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: data?.candidates?.[0]?.finishReason ?? "stop",
      }],
    };
  };
}

export const invokeCodeAssist = createCodeAssistInvoker();
