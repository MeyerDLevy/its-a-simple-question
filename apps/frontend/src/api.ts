export type Answer = "Yes" | "No" | "Maybe";

export const MODEL_OPTIONS = [
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { id: "openai/gpt-4-turbo", label: "GPT-4 Turbo" },
  { id: "mistralai/ministral-14b-2512", label: "Ministral 14B" },
  { id: "google/gemma-4-26b-a4b-it", label: "Gemma 4 26B" },
  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "qwen/qwen3.5-27b", label: "Qwen 3.5 27B" }
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

export async function askQuestion(
  question: string,
  model: ModelId,
  allowMaybe: boolean
): Promise<AnswerResponse> {
  const response = await fetch(`${apiBaseUrl}/api/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question, model, allowMaybe })
  });

  const payload = (await response.json()) as AnswerResponse | { error?: string };

  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "Request failed.");
  }

  return payload as AnswerResponse;
}

export async function askQuestions(
  question: string,
  models: ModelId[],
  allowMaybe: boolean
): Promise<ModelRunResult[]> {
  return Promise.all(
    models.map(async (model) => {
      try {
        return { model, ok: true as const, result: await askQuestion(question, model, allowMaybe) };
      } catch (runError) {
        return {
          model,
          ok: false as const,
          error: runError instanceof Error ? runError.message : "Request failed."
        };
      }
    })
  );
}
