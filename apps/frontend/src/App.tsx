import { AlertCircle, Loader2, SendHorizontal } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import {
  AnswerResponse,
  MODEL_OPTIONS,
  ModelId,
  ModelRunResult,
  askQuestions
} from "./api";

const EXAMPLES = [
  "Does God exist?",
  "Is it wrong to kill another person?",
  "Is there intelligent life on other planets?"
];

const BIN_COUNT = 10;

export default function App() {
  const [question, setQuestion] = useState("");
  const [selectedModels, setSelectedModels] = useState<Record<ModelId, boolean>>(
    () => Object.fromEntries(MODEL_OPTIONS.map((model) => [model.id, false])) as Record<ModelId, boolean>
  );
  const [results, setResults] = useState<ModelRunResult[]>([]);
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

    try {
      const runResults = await askQuestions(question.trim(), activeModels);
      setResults(runResults);

      if (runResults.every((run) => !run.ok)) {
        setError(runResults.map((run) => `${run.model}: ${run.error}`).join(" "));
      }
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
            Ask a binary question. Pick one or more models that support constrained decoding, then compare
            their Yes/No token probabilities on the right.
          </p>
        </div>

        <form className="question-form" onSubmit={handleSubmit}>
          <fieldset className="model-control">
            <legend>Models</legend>
            <p className="model-hint">Structured Outputs only. All unchecked by default.</p>
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
            <span>
              {question.length}/2000 · {activeModels.length} model{activeModels.length === 1 ? "" : "s"} selected
            </span>
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
        {error ? <ErrorState message={error} /> : <ResultState results={results} isLoading={isLoading} />}
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

function ResultState({ results, isLoading }: { results: ModelRunResult[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="state-message">
        <Loader2 className="spin" size={24} />
        <div>
          <h2>Running constrained decoding</h2>
          <p>Waiting for structured Yes/No outputs from the selected models.</p>
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="state-message">
        <div className="empty-mark">?</div>
        <div>
          <h2>No question yet</h2>
          <p>Select at least one model, ask a question, and the probability histogram will appear here.</p>
        </div>
      </div>
    );
  }

  const successes = results.filter((run): run is Extract<ModelRunResult, { ok: true }> => run.ok);

  return (
    <div className="result-content">
      <ProbabilityHistogram results={successes.map((run) => run.result)} />

      <div className="model-results">
        {results.map((run) =>
          run.ok ? <ModelResultCard key={run.model} result={run.result} /> : <ModelErrorCard key={run.model} model={run.model} error={run.error} />
        )}
      </div>
    </div>
  );
}

function ProbabilityHistogram({ results }: { results: AnswerResponse[] }) {
  const bins = useMemo(() => buildProbabilityBins(results), [results]);

  if (results.length === 0) {
    return null;
  }

  const maxCount = Math.max(1, ...bins.flatMap((bin) => [bin.yesCount, bin.noCount]));

  return (
    <div className="histogram-panel">
      <div className="histogram-header">
        <h2>Probability distribution</h2>
        <p>{results.length} model run{results.length === 1 ? "" : "s"}</p>
      </div>

      <div className="histogram-legend">
        <span className="legend-yes">Yes</span>
        <span className="legend-no">No</span>
      </div>

      <div className="histogram" role="img" aria-label="Overlaid frequency distribution of Yes and No probabilities">
        {bins.map((bin) => (
          <div key={bin.label} className="histogram-bin">
            <div className="histogram-bars">
              <div
                className="histogram-bar yes-bar"
                style={{ height: `${(bin.yesCount / maxCount) * 100}%` }}
                title={`Yes: ${bin.yesCount} in ${bin.label}`}
              />
              <div
                className="histogram-bar no-bar"
                style={{ height: `${(bin.noCount / maxCount) * 100}%` }}
                title={`No: ${bin.noCount} in ${bin.label}`}
              />
            </div>
            <span className="histogram-label">{bin.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildProbabilityBins(results: AnswerResponse[]) {
  const bins = Array.from({ length: BIN_COUNT }, (_, index) => {
    const start = index / BIN_COUNT;
    const end = (index + 1) / BIN_COUNT;
    const label = `${Math.round(start * 100)}–${Math.round(end * 100)}%`;

    return {
      label,
      start,
      end,
      yesCount: 0,
      noCount: 0
    };
  });

  for (const result of results) {
    const yesProbability = result.probabilities.Yes.probability;
    const noProbability = result.probabilities.No.probability;

    if (yesProbability !== null) {
      const yesBin = bins.find((bin) => yesProbability >= bin.start && (yesProbability < bin.end || (bin.end === 1 && yesProbability <= 1)));
      if (yesBin) {
        yesBin.yesCount += 1;
      }
    }

    if (noProbability !== null) {
      const noBin = bins.find((bin) => noProbability >= bin.start && (noProbability < bin.end || (bin.end === 1 && noProbability <= 1)));
      if (noBin) {
        noBin.noCount += 1;
      }
    }
  }

  return bins;
}

function ModelResultCard({ result }: { result: AnswerResponse }) {
  const yesPercent = formatPercent(result.probabilities.Yes.probability);
  const noPercent = formatPercent(result.probabilities.No.probability);

  return (
    <article className="model-result-card">
      <div className="model-result-header">
        <div>
          <h3>{result.model}</h3>
          <p className={result.answer === "Yes" ? "answer-yes" : "answer-no"}>{result.answer}</p>
        </div>
        <div className="model-result-probs">
          <span className="prob-yes">Yes {yesPercent}</span>
          <span className="prob-no">No {noPercent}</span>
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

function formatPercent(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
