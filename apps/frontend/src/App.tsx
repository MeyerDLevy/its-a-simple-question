import { AlertCircle, Loader2, SendHorizontal } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Answer, AnswerResponse, MODEL_OPTIONS, ModelId, askQuestion } from "./api";

const EXAMPLES = [
  "Does God exist?",
  "Is it wrong to kill another person?",
  "Is there intelligent life on other planets?"
];

export default function App() {
  const [question, setQuestion] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelId>("gpt-4.1-mini");
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const canSubmit = question.trim().length > 0 && !isLoading;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      setResult(await askQuestion(question.trim(), selectedModel));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="question-panel" aria-labelledby="app-title">
        <div>
          <p className="eyebrow">Structured output probe</p>
          <h1 id="app-title">It's a Simple Question</h1>
          <p className="summary">
            Ask a binary question. The backend constrains the model to a strict Yes or No JSON enum
            and returns the output token probabilities.
          </p>
        </div>

        <form className="question-form" onSubmit={handleSubmit}>
          <div className="model-control">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value as ModelId)}
            >
              {MODEL_OPTIONS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          <label htmlFor="question">Question</label>
          <textarea
            id="question"
            value={question}
            maxLength={2000}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Type a yes/no question..."
            rows={7}
          />

          <div className="form-actions">
            <span>{question.length}/2000</span>
            <button type="submit" disabled={!canSubmit}>
              {isLoading ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
              Run
            </button>
          </div>
        </form>

        <div className="examples" aria-label="Example questions">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => setQuestion(example)}>
              {example}
            </button>
          ))}
        </div>
      </section>

      <section className="result-panel" aria-live="polite">
        {error ? <ErrorState message={error} /> : <ResultState result={result} isLoading={isLoading} />}
      </section>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="state-message error-message">
      <AlertCircle size={22} />
      <div>
        <h2>Request failed</h2>
        <p>{message}</p>
      </div>
    </div>
  );
}

function ResultState({ result, isLoading }: { result: AnswerResponse | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="state-message">
        <Loader2 className="spin" size={24} />
        <div>
          <h2>Running constrained decoding</h2>
          <p>Waiting for the structured Yes/No output.</p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="state-message">
        <div className="empty-mark">?</div>
        <div>
          <h2>No question yet</h2>
          <p>The result will show the selected answer and token-level probabilities.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="result-content">
      <div className="answer-header">
        <span>Answer</span>
        <strong className={result.answer === "Yes" ? "answer-yes" : "answer-no"}>{result.answer}</strong>
      </div>

      <ProbabilityBar answer="Yes" result={result} />
      <ProbabilityBar answer="No" result={result} />

      <dl className="metadata-grid">
        <div>
          <dt>Model</dt>
          <dd>{result.model}</dd>
        </div>
        <div>
          <dt>Decision token</dt>
          <dd>{result.decisionToken ?? "Unavailable"}</dd>
        </div>
      </dl>

      <details>
        <summary>Raw structured output</summary>
        <pre>{result.outputText}</pre>
      </details>

      <TopLogprobs result={result} />
    </div>
  );
}

function ProbabilityBar({ answer, result }: { answer: Answer; result: AnswerResponse }) {
  const value = result.probabilities[answer].probability;
  const percent = value === null ? null : Math.max(0, Math.min(100, value * 100));

  return (
    <div className="probability-row">
      <div className="probability-label">
        <span>{answer}</span>
        <strong>{percent === null ? "Unavailable" : `${percent.toFixed(2)}%`}</strong>
      </div>
      <div className="bar-track" aria-hidden="true">
        <div className={answer === "Yes" ? "bar-fill yes-fill" : "bar-fill no-fill"} style={{ width: `${percent ?? 0}%` }} />
      </div>
      <code>logprob {formatLogprob(result.probabilities[answer].logprob)}</code>
    </div>
  );
}

function TopLogprobs({ result }: { result: AnswerResponse }) {
  const rows = useMemo(() => result.topLogprobs.slice(0, 6), [result.topLogprobs]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <details>
      <summary>Top token logprobs</summary>
      <div className="token-list">
        {rows.map((row, index) => (
          <div key={`${row.token}-${index}`}>
            <code>{JSON.stringify(row.token)}</code>
            <span>{formatLogprob(row.logprob)}</span>
            <span>{(row.probability * 100).toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function formatLogprob(value: number | null) {
  return value === null ? "n/a" : value.toFixed(4);
}
