export type Answer = "Yes" | "No" | "Maybe";

export const MODEL_OPTIONS = [
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "mistralai/ministral-14b-2512", label: "Ministral 14B" },
  { id: "google/gemma-4-26b-a4b-it", label: "Gemma 4 26B" },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "qwen/qwen3.7-plus", label: "Qwen 3.7 Plus" },
  { id: "minimax/minimax-m2.5", label: "MiniMax M2.5" },
  { id: "z-ai/glm-4.7", label: "GLM 4.7" }
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

export type AnswerProbability = {
  logprob: number | null;
  probability: number | null;
};

export type AnswerResponse = {
  question: string;
  model: string;
  allowMaybe: boolean;
  answer: Answer;
  outputText: string;
  probabilities: Partial<Record<Answer, AnswerProbability>>;
  decisionToken: string | null;
  topLogprobs: Array<{
    token: string;
    logprob: number;
    probability: number;
  }>;
  probabilityNote: string | null;
  usage: unknown;
};

const apiBaseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export type ModelRunResult =
  | { model: ModelId; ok: true; result: AnswerResponse }
  | { model: ModelId; ok: false; error: string };

type ApiErrorPayload = {
  error?: string;
  requestId?: string | null;
  model?: string;
  upstreamStatus?: number | null;
};

export async function askQuestion(
  question: string,
  model: ModelId,
  allowMaybe: boolean
): Promise<AnswerResponse> {
  const requestBody = { question, model, allowMaybe };
  const url = `${apiBaseUrl}/api/answer`;

  console.log(`[answer] ${model} → POST ${url}`, requestBody);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  const payload = (await response.json()) as AnswerResponse | ApiErrorPayload;
  const requestId = response.headers.get("X-Request-Id");

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload;
    console.error(`[answer] ${model} failed`, {
      status: response.status,
      requestId: errorPayload.requestId ?? requestId,
      model: errorPayload.model ?? model,
      upstreamStatus: errorPayload.upstreamStatus ?? null,
      error: errorPayload.error ?? "Request failed.",
      payload
    });
    throw new Error(errorPayload.error ?? "Request failed.");
  }

  const result = payload as AnswerResponse;
  console.log(`[answer] ${model} ok`, {
    requestId,
    resolvedModel: result.model,
    answer: result.answer,
    probabilities: result.probabilities,
    decisionToken: result.decisionToken
  });

  return result;
}

export async function askQuestions(
  question: string,
  models: ModelId[],
  allowMaybe: boolean
): Promise<ModelRunResult[]> {
  console.log(`[answer] run start`, { models, allowMaybe, questionLength: question.length });

  const results = await Promise.all(
    models.map(async (model) => {
      try {
        return { model, ok: true as const, result: await askQuestion(question, model, allowMaybe) };
      } catch (runError) {
        const error = runError instanceof Error ? runError.message : "Request failed.";
        console.error(`[answer] ${model} caught`, { error });
        return {
          model,
          ok: false as const,
          error
        };
      }
    })
  );

  const failed = results.filter((run) => !run.ok);
  console.log(`[answer] run finish`, {
    total: results.length,
    ok: results.length - failed.length,
    failed: failed.map((run) => ({ model: run.model, error: run.error }))
  });

  return results;
}
