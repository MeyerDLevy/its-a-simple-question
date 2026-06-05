import cors from "cors";
import crypto from "node:crypto";
import "dotenv/config";
import express from "express";
import OpenAI from "openai";

type Answer = "Yes" | "No" | "Maybe";

type LogprobCandidate = {
  token: string;
  logprob: number;
  probability: number;
};

type AnswerProbability = {
  logprob: number | null;
  probability: number | null;
};

const AVAILABLE_MODELS = [
  "openai/gpt-4.1",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1-nano",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "meta-llama/llama-3.3-70b-instruct",
  "mistralai/mistral-large",
  "deepseek/deepseek-chat",
  "qwen/qwen-2.5-72b-instruct"
] as const;

type ModelId = (typeof AVAILABLE_MODELS)[number];

type RequestWithId = express.Request & {
  requestId?: string;
};

const DEFAULT_MODEL: ModelId = "openai/gpt-4o-mini";
const PORT = Number(process.env.PORT ?? 3001);
const FALLBACK_MODEL = getFallbackModel(process.env.OPENROUTER_MODEL);
const MAX_QUESTION_LENGTH = 2000;

const app = express();
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "missing-key",
  defaultHeaders: {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "",
    "X-Title": process.env.OPENROUTER_SITE_NAME ?? "It's a Simple Question"
  }
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

    if (!process.env.OPENROUTER_API_KEY) {
      logError("answer:missing_api_key", { requestId });
      res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the backend." });
      return;
    }

    const question = parseQuestion(req.body?.question);
    const model = parseModel(req.body?.model, FALLBACK_MODEL);
    const allowMaybe = parseAllowMaybe(req.body?.allowMaybe);

    logInfo("answer:openrouter_request:start", {
      requestId,
      model,
      allowMaybe,
      questionLength: question.length
    });

    const allowedAnswers = getAllowedAnswers(allowMaybe);

    const response = await openai.chat.completions.create({
      model,
      temperature: 0,
      logprobs: true,
      top_logprobs: 20,
      messages: [
        { role: "system", content: buildInstructions(allowMaybe) },
        { role: "user", content: question }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "yes_no_answer",
          strict: true,
          schema: buildAnswerSchema(allowMaybe)
        }
      },
      provider: { require_parameters: true }
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

    logInfo("answer:openrouter_request:finish", {
      requestId,
      responseId: response.id,
      model: response.model ?? model,
      outputTokenCount: response.usage?.completion_tokens ?? null,
      totalTokenCount: response.usage?.total_tokens ?? null
    });

    const outputText = response.choices[0]?.message?.content ?? "";
    const parsed = parseStructuredAnswer(outputText, allowMaybe);
    const logprobs = collectOutputLogprobs(response);
    const probabilityData = extractAnswerProbabilities(logprobs, parsed.answer, allowedAnswers);
    const answer = pickHighestProbabilityAnswer(probabilityData.probabilities) ?? parsed.answer;

    logInfo("answer:complete", {
      requestId,
      answer,
      emittedAnswer: parsed.answer,
      decisionToken: probabilityData.decisionToken,
      hasYesProbability: probabilityData.probabilities.Yes?.probability !== null,
      hasNoProbability: probabilityData.probabilities.No?.probability !== null,
      hasMaybeProbability: probabilityData.probabilities.Maybe?.probability !== null
    });

    res.json({
      question,
      model: response.model ?? model,
      allowMaybe,
      answer,
      outputText,
      probabilities: probabilityData.probabilities,
      decisionToken: probabilityData.decisionToken,
      topLogprobs: probabilityData.topLogprobs,
      probabilityNote: null,
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

function parseAllowMaybe(value: unknown): boolean {
  return value === true;
}

function getAllowedAnswers(allowMaybe: boolean): Answer[] {
  return allowMaybe ? ["Yes", "No", "Maybe"] : ["Yes", "No"];
}

function buildInstructions(allowMaybe: boolean): string {
  if (allowMaybe) {
    return "Answer the user's question using only the structured JSON schema. Choose Yes when the answer is more likely yes, No when it is more likely no, and Maybe when the question is genuinely uncertain or not clearly yes or no. Do not add explanation.";
  }

  return "Answer the user's question using only the structured JSON schema. Choose Yes when the answer is more likely yes, otherwise choose No. Do not add explanation.";
}

function buildAnswerSchema(allowMaybe: boolean) {
  return {
    type: "object",
    properties: {
      answer: {
        type: "string",
        enum: getAllowedAnswers(allowMaybe)
      }
    },
    required: ["answer"],
    additionalProperties: false
  };
}

function parseStructuredAnswer(outputText: string, allowMaybe: boolean): { answer: Answer } {
  const parsed = JSON.parse(outputText) as { answer?: unknown };
  const allowedAnswers = getAllowedAnswers(allowMaybe);

  if (!allowedAnswers.includes(parsed.answer as Answer)) {
    throw new Error("Model returned an invalid structured answer.");
  }

  return { answer: parsed.answer as Answer };
}

function collectOutputLogprobs(response: OpenAI.Chat.ChatCompletion): Array<{
  token: string;
  logprob: number;
  top_logprobs?: Array<{ token: string; logprob: number }>;
}> {
  const content = response.choices[0]?.logprobs?.content ?? [];
  const entries: Array<{
    token: string;
    logprob: number;
    top_logprobs?: Array<{ token: string; logprob: number }>;
  }> = [];

  for (const entry of content) {
    if (typeof entry.token !== "string" || typeof entry.logprob !== "number") {
      continue;
    }

    const topLogprobs = (entry.top_logprobs ?? [])
      .map((candidate) => {
        if (typeof candidate.token !== "string" || typeof candidate.logprob !== "number") {
          return null;
        }

        return { token: candidate.token, logprob: candidate.logprob };
      })
      .filter((candidate): candidate is { token: string; logprob: number } => candidate !== null);

    entries.push({
      token: entry.token,
      logprob: entry.logprob,
      top_logprobs: topLogprobs.length > 0 ? topLogprobs : undefined
    });
  }

  return entries;
}

function extractAnswerProbabilities(
  logprobs: ReturnType<typeof collectOutputLogprobs>,
  answer: Answer,
  allowedAnswers: Answer[]
): {
  probabilities: Partial<Record<Answer, AnswerProbability>>;
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
      probabilities: emptyProbabilities(allowedAnswers),
      decisionToken: null,
      topLogprobs: []
    };
  }

  const candidateMap = new Map<Answer, number>();

  for (const candidate of decisionEntry.top_logprobs ?? []) {
    const classified = classifyAnswerToken(candidate.token);

    if (!classified || !allowedAnswers.includes(classified)) {
      continue;
    }

    const existing = candidateMap.get(classified);
    if (existing === undefined || candidate.logprob > existing) {
      candidateMap.set(classified, candidate.logprob);
    }
  }

  const selectedClass = classifyAnswerToken(decisionEntry.token);
  if (selectedClass && allowedAnswers.includes(selectedClass)) {
    const existing = candidateMap.get(selectedClass);
    if (existing === undefined || decisionEntry.logprob > existing) {
      candidateMap.set(selectedClass, decisionEntry.logprob);
    }
  }

  const logprobValues = Object.fromEntries(
    allowedAnswers.map((option) => [option, candidateMap.get(option) ?? null])
  ) as Partial<Record<Answer, number | null>>;

  return {
    probabilities: normalizeLogprobs(logprobValues, allowedAnswers),
    decisionToken: decisionEntry.token,
    topLogprobs: (decisionEntry.top_logprobs ?? []).slice(0, 10).map((candidate) => ({
      token: candidate.token,
      logprob: candidate.logprob,
      probability: Math.exp(candidate.logprob)
    }))
  };
}

function pickHighestProbabilityAnswer(
  probabilities: Partial<Record<Answer, AnswerProbability>>
): Answer | null {
  let best: Answer | null = null;
  let bestProbability = -Infinity;

  for (const [option, value] of Object.entries(probabilities) as Array<[Answer, AnswerProbability]>) {
    if (value.probability !== null && value.probability > bestProbability) {
      best = option;
      bestProbability = value.probability;
    }
  }

  return best;
}

function classifyAnswerToken(token: string): Answer | null {
  const normalized = token.replace(/[\s"'`:,{}[\]]/g, "");

  if (normalized === "Yes") {
    return "Yes";
  }

  if (normalized === "No") {
    return "No";
  }

  if (normalized === "Maybe") {
    return "Maybe";
  }

  return null;
}

function normalizeLogprobs(
  values: Partial<Record<Answer, number | null>>,
  allowedAnswers: Answer[]
): Partial<Record<Answer, AnswerProbability>> {
  const present = allowedAnswers.filter((option) => values[option] !== null && values[option] !== undefined);

  if (present.length !== allowedAnswers.length) {
    return Object.fromEntries(
      allowedAnswers.map((option) => {
        const logprob = values[option] ?? null;
        return [
          option,
          {
            logprob,
            probability: logprob === null ? null : Math.exp(logprob)
          }
        ];
      })
    );
  }

  const logprobs = allowedAnswers.map((option) => values[option] as number);
  const max = Math.max(...logprobs);
  const expValues = logprobs.map((logprob) => Math.exp(logprob - max));
  const denominator = expValues.reduce((sum, value) => sum + value, 0);

  return Object.fromEntries(
    allowedAnswers.map((option, index) => [
      option,
      {
        logprob: logprobs[index],
        probability: expValues[index] / denominator
      }
    ])
  );
}

function emptyProbabilities(allowedAnswers: Answer[]): Partial<Record<Answer, AnswerProbability>> {
  return Object.fromEntries(
    allowedAnswers.map((option) => [option, { logprob: null, probability: null }])
  );
}
