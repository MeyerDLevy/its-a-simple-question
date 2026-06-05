import cors from "cors";
import "dotenv/config";
import express from "express";
import OpenAI from "openai";

type Answer = "Yes" | "No";

type LogprobCandidate = {
  token: string;
  logprob: number;
  probability: number;
};

type AnswerProbability = {
  logprob: number | null;
  probability: number | null;
};

const DEFAULT_MODEL = "gpt-4.1-mini";
const PORT = Number(process.env.PORT ?? 3001);
const MODEL = process.env.OPENAI_MODEL || DEFAULT_MODEL;
const MAX_QUESTION_LENGTH = 2000;

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "missing-key"
});

const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(express.json({ limit: "32kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS_ORIGIN`));
    }
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/answer", async (req, res, next) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: "OPENAI_API_KEY is not configured on the backend." });
      return;
    }

    const question = parseQuestion(req.body?.question);

    const response = await openai.responses.create({
      model: MODEL,
      instructions:
        "Answer the user's question using only the structured JSON schema. Choose Yes when the answer is more likely yes, otherwise choose No. Do not add explanation.",
      input: [
        {
          role: "user",
          content: question
        }
      ],
      temperature: 0,
      top_logprobs: 20,
      include: ["message.output_text.logprobs"],
      text: {
        format: {
          type: "json_schema",
          name: "yes_no_answer",
          strict: true,
          schema: {
            type: "object",
            properties: {
              answer: {
                type: "string",
                enum: ["Yes", "No"]
              }
            },
            required: ["answer"],
            additionalProperties: false
          }
        }
      }
    });

    const outputText = response.output_text;
    const parsed = parseStructuredAnswer(outputText);
    const logprobs = collectOutputLogprobs(response);
    const probabilityData = extractAnswerProbabilities(logprobs, parsed.answer);

    res.json({
      question,
      model: response.model ?? MODEL,
      answer: parsed.answer,
      outputText,
      probabilities: probabilityData.probabilities,
      decisionToken: probabilityData.decisionToken,
      topLogprobs: probabilityData.topLogprobs,
      usage: response.usage ?? null
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status = message.includes("Question") ? 400 : 500;
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});

function parseQuestion(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Question must be a string.");
  }

  const question = value.trim();

  if (!question) {
    throw new Error("Question is required.");
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    throw new Error(`Question must be ${MAX_QUESTION_LENGTH} characters or fewer.`);
  }

  return question;
}

function parseStructuredAnswer(outputText: string): { answer: Answer } {
  const parsed = JSON.parse(outputText) as { answer?: unknown };

  if (parsed.answer !== "Yes" && parsed.answer !== "No") {
    throw new Error("Model returned an invalid structured answer.");
  }

  return { answer: parsed.answer };
}

function collectOutputLogprobs(response: OpenAI.Responses.Response): Array<{
  token: string;
  logprob: number;
  top_logprobs?: Array<{ token: string; logprob: number }>;
}> {
  const output = (response as unknown as { output?: unknown[] }).output ?? [];
  const entries: Array<{
    token: string;
    logprob: number;
    top_logprobs?: Array<{ token: string; logprob: number }>;
  }> = [];

  for (const item of output) {
    const content = (item as { content?: unknown[] }).content ?? [];

    for (const part of content) {
      const logprobs = (part as { logprobs?: unknown[] }).logprobs ?? [];

      for (const entry of logprobs) {
        const token = (entry as { token?: unknown }).token;
        const logprob = (entry as { logprob?: unknown }).logprob;
        const topLogprobs = (entry as { top_logprobs?: unknown[] }).top_logprobs;

        if (typeof token === "string" && typeof logprob === "number") {
          entries.push({
            token,
            logprob,
            top_logprobs: Array.isArray(topLogprobs)
              ? topLogprobs
                  .map((candidate) => {
                    const candidateToken = (candidate as { token?: unknown }).token;
                    const candidateLogprob = (candidate as { logprob?: unknown }).logprob;

                    if (typeof candidateToken !== "string" || typeof candidateLogprob !== "number") {
                      return null;
                    }

                    return { token: candidateToken, logprob: candidateLogprob };
                  })
                  .filter((candidate): candidate is { token: string; logprob: number } => candidate !== null)
              : undefined
          });
        }
      }
    }
  }

  return entries;
}

function extractAnswerProbabilities(
  logprobs: ReturnType<typeof collectOutputLogprobs>,
  answer: Answer
): {
  probabilities: Record<Answer, AnswerProbability>;
  decisionToken: string | null;
  topLogprobs: LogprobCandidate[];
} {
  const decisionEntry =
    logprobs.find((entry) => classifyAnswerToken(entry.token) === answer) ??
    logprobs.find((entry) => {
      const candidates = entry.top_logprobs ?? [];
      return candidates.some((candidate) => classifyAnswerToken(candidate.token) !== null);
    });

  if (!decisionEntry) {
    return {
      probabilities: emptyProbabilities(),
      decisionToken: null,
      topLogprobs: []
    };
  }

  const candidateMap = new Map<Answer, number>();

  for (const candidate of decisionEntry.top_logprobs ?? []) {
    const classified = classifyAnswerToken(candidate.token);

    if (!classified) {
      continue;
    }

    const existing = candidateMap.get(classified);
    if (existing === undefined || candidate.logprob > existing) {
      candidateMap.set(classified, candidate.logprob);
    }
  }

  const selectedClass = classifyAnswerToken(decisionEntry.token);
  if (selectedClass) {
    const existing = candidateMap.get(selectedClass);
    if (existing === undefined || decisionEntry.logprob > existing) {
      candidateMap.set(selectedClass, decisionEntry.logprob);
    }
  }

  const yesLogprob = candidateMap.get("Yes") ?? null;
  const noLogprob = candidateMap.get("No") ?? null;
  const probabilities = normalizeBinaryLogprobs(yesLogprob, noLogprob);

  return {
    probabilities,
    decisionToken: decisionEntry.token,
    topLogprobs: (decisionEntry.top_logprobs ?? []).slice(0, 10).map((candidate) => ({
      token: candidate.token,
      logprob: candidate.logprob,
      probability: Math.exp(candidate.logprob)
    }))
  };
}

function classifyAnswerToken(token: string): Answer | null {
  const normalized = token.replace(/[\s"'`:,{}[\]]/g, "");

  if (normalized === "Yes") {
    return "Yes";
  }

  if (normalized === "No") {
    return "No";
  }

  return null;
}

function normalizeBinaryLogprobs(
  yesLogprob: number | null,
  noLogprob: number | null
): Record<Answer, AnswerProbability> {
  if (yesLogprob === null || noLogprob === null) {
    return {
      Yes: {
        logprob: yesLogprob,
        probability: yesLogprob === null ? null : Math.exp(yesLogprob)
      },
      No: {
        logprob: noLogprob,
        probability: noLogprob === null ? null : Math.exp(noLogprob)
      }
    };
  }

  const max = Math.max(yesLogprob, noLogprob);
  const yesExp = Math.exp(yesLogprob - max);
  const noExp = Math.exp(noLogprob - max);
  const denominator = yesExp + noExp;

  return {
    Yes: {
      logprob: yesLogprob,
      probability: yesExp / denominator
    },
    No: {
      logprob: noLogprob,
      probability: noExp / denominator
    }
  };
}

function emptyProbabilities(): Record<Answer, AnswerProbability> {
  return {
    Yes: { logprob: null, probability: null },
    No: { logprob: null, probability: null }
  };
}
