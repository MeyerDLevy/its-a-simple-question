import { AlertCircle, ArrowDown, ArrowUp, Heart, Loader2, SendHorizontal } from "lucide-react";
import { FormEvent, useState } from "react";
import {
  Answer,
  AnswerResponse,
  MODEL_OPTIONS,
  ModelId,
  askQuestion
} from "./api";

type ModelRunState =
  | { model: ModelId; status: "pending" }
  | { model: ModelId; status: "ok"; result: AnswerResponse }
  | { model: ModelId; status: "error"; error: string };

type SortField = "yes" | "no" | "provider";
type SortState = { field: SortField; direction: "asc" | "desc" } | null;

const MODEL_LABELS = Object.fromEntries(MODEL_OPTIONS.map((model) => [model.id, model.label])) as Record<
  ModelId,
  string
>;

const EXAMPLES = [
  "Does God exist?",
  "Is it wrong to kill another person?",
  "Is there intelligent life on other planets?"
];

const STRIPE_DONATION_URL = import.meta.env.VITE_STRIPE_DONATION_URL;

export default function App() {
  const [question, setQuestion] = useState("");
  const [allowMaybe, setAllowMaybe] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Record<ModelId, boolean>>(
    () =>
      Object.fromEntries(
        MODEL_OPTIONS.map((model) => [model.id, model.id === "openai/gpt-4o-mini"])
      ) as Record<ModelId, boolean>
  );
  const [runs, setRuns] = useState<ModelRunState[]>([]);
  const [sort, setSort] = useState<SortState>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const activeModels = MODEL_OPTIONS.filter((model) => selectedModels[model.id]).map((model) => model.id);
  const canSubmit = question.trim().length > 0 && activeModels.length > 0 && !isLoading;

  function toggleModel(modelId: ModelId) {
    setSelectedModels((current) => ({ ...current, [modelId]: !current[modelId] }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setRuns(activeModels.map((model) => ({ model, status: "pending" as const })));

    const trimmedQuestion = question.trim();
    const outcomes = await Promise.all(
      activeModels.map(async (model) => {
        try {
          const result = await askQuestion(trimmedQuestion, model, allowMaybe);
          setRuns((current) =>
            current.map((run) => (run.model === model ? { model, status: "ok" as const, result } : run))
          );
          return { model, status: "ok" as const, result };
        } catch (runError) {
          const runErrorMessage = runError instanceof Error ? runError.message : "Request failed.";
          setRuns((current) =>
            current.map((run) =>
              run.model === model ? { model, status: "error" as const, error: runErrorMessage } : run
            )
          );
          return { model, status: "error" as const, error: runErrorMessage };
        }
      })
    );

    if (outcomes.every((run) => run.status === "error")) {
      setError(outcomes.map((run) => `${run.model}: ${run.error}`).join(" "));
    }

    setIsLoading(false);
  }

  return (
    <main className="app-shell">
      {STRIPE_DONATION_URL ? (
        <a className="donate-button" href={STRIPE_DONATION_URL} target="_blank" rel="noreferrer">
          <Heart size={16} />
          Donate
        </a>
      ) : null}

      <h1 className="page-title" id="app-title">What Do Language Models Really Think?</h1>

      <section className="question-panel" aria-labelledby="app-title">
        <div>
          <p className="summary">
            Ask difficult questions to large language models and get honest answers. This tool uses{" "}
            <strong>constrained decoding</strong> to force the model to choose between{" "}
            <span className="prob-yes">&apos;Yes&apos;</span> or <span className="prob-no">&apos;No&apos;</span>{" "}
            regardless of what they are asked. Likelihoods of giving either answer are given for each model in the
            sidebar on the right.
          </p>
        </div>

        <form className="question-form" onSubmit={handleSubmit}>
          <div className="field-label-row">
            <label htmlFor="question">Question</label>
            <span className="field-meta">{question.length}/2000</span>
          </div>
          <textarea
            id="question"
            value={question}
            maxLength={2000}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Type a yes/no question..."
            rows={5}
          />

          <div className="examples" aria-label="Example questions">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => setQuestion(example)}>
                {example}
              </button>
            ))}
          </div>

          <div className="run-row">
            <label className="maybe-checkbox">
              <input
                type="checkbox"
                checked={allowMaybe}
                onChange={(event) => setAllowMaybe(event.target.checked)}
              />
              <span>Allow &apos;Maybe&apos; Answer</span>
            </label>
            <button type="submit" className="run-button" disabled={!canSubmit}>
              {isLoading ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
              Run
            </button>
          </div>

          <fieldset className="model-control">
            <legend>Models</legend>
            <div className="field-label-row">
              <p className="model-hint">GPT-4o mini selected by default.</p>
              <span className="field-meta">
                {activeModels.length} model{activeModels.length === 1 ? "" : "s"} selected
              </span>
            </div>
            <div className="model-grid">
              {MODEL_OPTIONS.map((model) => (
                <label key={model.id} className="model-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedModels[model.id]}
                    onChange={() => toggleModel(model.id)}
                  />
                  <span>{model.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </form>
      </section>

      <section className="result-panel" aria-live="polite">
        {error ? (
          <ErrorState message={error} />
        ) : (
          <ResultState runs={runs} allowMaybe={allowMaybe} sort={sort} setSort={setSort} />
        )}
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

function ResultState({
  runs,
  allowMaybe,
  sort,
  setSort
}: {
  runs: ModelRunState[];
  allowMaybe: boolean;
  sort: SortState;
  setSort: (sort: SortState) => void;
}) {
  if (runs.length === 0) {
    return (
      <div className="state-message">
        <div className="empty-mark">?</div>
        <div>
          <h2>No question yet</h2>
          <p>Select at least one model, ask a question, and results will appear here.</p>
        </div>
      </div>
    );
  }

  const sortedRuns = sortRuns(runs, sort);

  return (
    <div className="result-content">
      <SortControls sort={sort} setSort={setSort} />
      <div className="model-results">
        {sortedRuns.map((run) => {
          if (run.status === "pending") {
            return <ModelPendingCard key={run.model} model={run.model} allowMaybe={allowMaybe} />;
          }

          if (run.status === "ok") {
            return <ModelResultCard key={run.model} result={run.result} />;
          }

          return <ModelErrorCard key={run.model} model={run.model} error={run.error} />;
        })}
      </div>
    </div>
  );
}

function SortControls({
  sort,
  setSort
}: {
  sort: SortState;
  setSort: (sort: SortState) => void;
}) {
  return (
    <div className="sort-toolbar" aria-label="Sort results">
      <SortGroup
        label="Yes"
        labelClassName="prob-yes"
        field="yes"
        sort={sort}
        setSort={setSort}
      />
      <SortGroup
        label="No"
        labelClassName="prob-no"
        field="no"
        sort={sort}
        setSort={setSort}
      />
      <SortGroup
        label="Provider"
        labelClassName="sort-label-provider"
        field="provider"
        sort={sort}
        setSort={setSort}
      />
    </div>
  );
}

function SortGroup({
  label,
  labelClassName,
  field,
  sort,
  setSort
}: {
  label: string;
  labelClassName: string;
  field: SortField;
  sort: SortState;
  setSort: (sort: SortState) => void;
}) {
  return (
    <div className="sort-group">
      <span className={labelClassName}>{label}</span>
      <div className="sort-arrows">
        <button
          type="button"
          className={`sort-arrow${sort?.field === field && sort.direction === "asc" ? " is-active" : ""}`}
          aria-label={`Sort by ${label} ascending`}
          onClick={() => setSort({ field, direction: "asc" })}
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          className={`sort-arrow${sort?.field === field && sort.direction === "desc" ? " is-active" : ""}`}
          aria-label={`Sort by ${label} descending`}
          onClick={() => setSort({ field, direction: "desc" })}
        >
          <ArrowDown size={14} />
        </button>
      </div>
    </div>
  );
}

function runProbability(run: ModelRunState, answer: "Yes" | "No") {
  if (run.status !== "ok") {
    return null;
  }

  return run.result.probabilities[answer]?.probability ?? null;
}

function runProvider(run: ModelRunState) {
  return run.model.split("/")[0];
}

function sortRuns(runs: ModelRunState[], sort: SortState) {
  if (!sort) {
    return runs;
  }

  const { field, direction } = sort;
  const sign = direction === "asc" ? 1 : -1;

  return [...runs].sort((left, right) => {
    if (field === "provider") {
      return sign * runProvider(left).localeCompare(runProvider(right));
    }

    const answer = field === "yes" ? "Yes" : "No";
    const leftProb = runProbability(left, answer);
    const rightProb = runProbability(right, answer);

    if (leftProb === null && rightProb === null) {
      return 0;
    }

    if (leftProb === null) {
      return 1;
    }

    if (rightProb === null) {
      return -1;
    }

    return sign * (leftProb - rightProb);
  });
}

function ModelPendingCard({ model, allowMaybe }: { model: ModelId; allowMaybe: boolean }) {
  return (
    <article className="model-result-card model-result-pending">
      <div className="model-result-header">
        <div>
          <h3>{MODEL_LABELS[model]}</h3>
          <Loader2 className="spin model-result-loading" size={24} aria-label="Loading" />
        </div>
        <div className="model-result-probs">
          <span className="prob-yes">Yes</span>
          <span className="prob-no">No</span>
          {allowMaybe ? <span className="prob-maybe">Maybe</span> : null}
        </div>
      </div>
    </article>
  );
}

function ModelResultCard({ result }: { result: AnswerResponse }) {
  const yesPercent = formatPercent(result.probabilities.Yes?.probability ?? null);
  const noPercent = formatPercent(result.probabilities.No?.probability ?? null);
  const maybePercent = formatPercent(result.probabilities.Maybe?.probability ?? null);

  return (
    <article className="model-result-card">
      <div className="model-result-header">
        <div>
          <h3>{result.model}</h3>
          <p className={answerClass(result.answer)}>{result.answer}</p>
          {result.probabilityNote ? <p className="probability-note">{result.probabilityNote}</p> : null}
        </div>
        <div className="model-result-probs">
          <span className="prob-yes">Yes {yesPercent}</span>
          <span className="prob-no">No {noPercent}</span>
          {result.allowMaybe ? <span className="prob-maybe">Maybe {maybePercent}</span> : null}
        </div>
      </div>
    </article>
  );
}

function ModelErrorCard({ model, error }: { model: ModelId; error: string }) {
  return (
    <article className="model-result-card model-result-error">
      <h3>{model}</h3>
      <p>{error}</p>
    </article>
  );
}

function answerClass(answer: Answer) {
  if (answer === "Yes") {
    return "answer-yes";
  }

  if (answer === "No") {
    return "answer-no";
  }

  return "answer-maybe";
}

function formatPercent(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
