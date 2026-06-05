import cors from "cors";
import crypto from "node:crypto";
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

const AVAILABLE_MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini"] as const;

type ModelId = (typeof AVAILABLE_MODELS)[number];

type RequestWithId = express.Request & {
  requestId?: string;
};

const DEFAULT_MODEL: ModelId = "gpt-4.1-mini";
const PORT = Number(process.env.PORT ?? 3001);
const FALLBACK_MODEL = getFallbackModel(process.env.OPENAI_MODEL);
const MAX_QUESTION_LENGTH = 2000;

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "missing-key"
});

const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req: RequestWithId, res, next) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  logInfo("request:start", {
    requestId,
    method: req.method,
    path: req.path,
    origin: req.headers.origin ?? null
  });

  res.on("finish", () => {
    logInfo("request:finish", {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
});

app.use(express.json({ limit: "32kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        logInfo("cors:allowed", {
          origin: origin ?? null,
          mode: allowedOrigins.length === 0 ? "allow_all" : "allowlist"
        });
        callback(null, true);
        return;
      }

      logError("cors:blocked", {
        origin,
        allowedOrigins
      });
      callback(new Error(`Origin ${origin} is not allowed by CORS_ORIGIN`));
    }
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/answer", async (req, res, next) => {
  try {
    const requestId = (req as RequestWithId).requestId ?? null;

    if (!process.env.OPENAI_API_KEY) {
      logError("answer:missing_api_key", { requestId });
      res.status(500).json({ error: "OPENAI_API_KEY is not configured on the backend." });
      return;
    }

    const question = parseQuestion(req.body?.question);
    const model = parseModel(req.body?.model, FALLBACK_MODEL);

    logInfo("answer:openai_request:start", {
      requestId,
      model,
      questionLength: question.length
    });

    const response = await openai.responses.create({
      model,
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

    logInfo("answer:openai_request:finish", {
      requestId,
      responseId: response.id,
      model: response.model ?? model,
      outputTokenCount: response.usage?.output_tokens ?? null,
      totalTokenCount: response.usage?.total_tokens ?? null
    });

    const outputText = response.output_text;
    const parsed = parseStructuredAnswer(outputText);
    const logprobs = collectOutputLogprobs(response);
    const probabilityData = extractAnswerProbabilities(logprobs, parsed.answer);

    logInfo("answer:complete", {
      requestId,
      answer: parsed.answer,
      decisionToken: probabilityData.decisionToken,
      hasYesProbability: probabilityData.probabilities.Yes.probability !== null,
      hasNoProbability: probabilityData.probabilities.No.probability !== null
    });

    res.json({
      question,
      model: response.model ?? model,
      answer: parsed.answer,
      outputText,
      probabilities: probabilityData.probabilities,
      decisionToken: probabilityData.decisionToken,
      topLogprobs: probabilityData.topLogprobs,
      usage: response.usage ?? null
    });
  } catch (error) {
    logError("answer:error", errorToLog(error, (req as RequestWithId).requestId ?? null));
    next(error);
  }
});

app.use((error: unknown, req: RequestWithId, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status = message.includes("Question") || message.includes("Model") ? 400 : 500;
  logError("request:error_response", {
    requestId: req.requestId ?? null,
    statusCode: status,
    message
  });
  res.status(status).json({ error: message, requestId: req.requestId ?? null });
});

app.listen(PORT, () => {
  logInfo("server:listening", {
    port: PORT,
    defaultModel: FALLBACK_MODEL,
    availableModels: AVAILABLE_MODELS,
    corsOrigins: allowedOrigins.length === 0 ? "all" : allowedOrigins
  });
});

function logInfo(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ level: "info", event, ...data }));
}

function logError(event: string, data: Record<string, unknown>) {
  console.error(JSON.stringify({ level: "error", event, ...data }));
}

function errorToLog(error: unknown, requestId: string | null): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      requestId,
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    requestId,
    message: String(error)
  };
}

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

function parseModel(value: unknown, fallback: ModelId): ModelId {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new Error("Model must be a string.");
  }

  if (!isAvailableModel(value)) {
    throw new Error(`Model must be one of: ${AVAILABLE_MODELS.join(", ")}.`);
  }

  return value;
}

function getFallbackModel(value: string | undefined): ModelId {
  return isAvailableModel(value) ? value : DEFAULT_MODEL;
}

function isAvailableModel(value: unknown): value is ModelId {
  return typeof value === "string" && AVAILABLE_MODELS.includes(value as ModelId);
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
