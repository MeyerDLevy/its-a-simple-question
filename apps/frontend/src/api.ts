export type Answer = "Yes" | "No";

export const MODEL_OPTIONS = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 nano" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" }
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

export type AnswerResponse = {
  question: string;
  model: string;
  answer: Answer;
  outputText: string;
  probabilities: Record<
    Answer,
    {
      logprob: number | null;
      probability: number | null;
    }
  >;
  decisionToken: string | null;
  topLogprobs: Array<{
    token: string;
    logprob: number;
    probability: number;
  }>;
  usage: unknown;
};

const apiBaseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export type ModelRunResult =
  | { model: ModelId; ok: true; result: AnswerResponse }
  | { model: ModelId; ok: false; error: string };

export async function askQuestion(question: string, model: ModelId): Promise<AnswerResponse> {
  const response = await fetch(`${apiBaseUrl}/api/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question, model })
  });

  const payload = (await response.json()) as AnswerResponse | { error?: string };

  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "Request failed.");
  }

  return payload as AnswerResponse;
}

export async function askQuestions(question: string, models: ModelId[]): Promise<ModelRunResult[]> {
  return Promise.all(
    models.map(async (model) => {
      try {
        return { model, ok: true as const, result: await askQuestion(question, model) };
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
