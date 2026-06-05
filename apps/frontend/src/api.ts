export type Answer = "Yes" | "No";

export const MODEL_OPTIONS = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
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
