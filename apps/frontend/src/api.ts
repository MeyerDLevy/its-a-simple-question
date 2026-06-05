export type Answer = "Yes" | "No" | "Maybe";

export const MODEL_OPTIONS = [
  { id: "openai/gpt-4.1", label: "GPT-4.1" },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "openai/gpt-4.1-nano", label: "GPT-4.1 nano" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { id: "mistralai/mistral-large", label: "Mistral Large" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
  { id: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B" }
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
