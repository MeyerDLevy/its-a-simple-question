export type Answer = "Yes" | "No";

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

export async function askQuestion(question: string): Promise<AnswerResponse> {
  const response = await fetch(`${apiBaseUrl}/api/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question })
  });

  const payload = (await response.json()) as AnswerResponse | { error?: string };

  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "Request failed.");
  }

  return payload as AnswerResponse;
}
