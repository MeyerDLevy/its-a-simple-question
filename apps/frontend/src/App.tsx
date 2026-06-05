import { AlertCircle, Loader2, SendHorizontal } from "lucide-react";
import { FormEvent, useState } from "react";
import {
  Answer,
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

export default function App() {
  const [question, setQuestion] = useState("");
  const [allowMaybe, setAllowMaybe] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Record<ModelId, boolean>>(
    () =>
      Object.fromEntries(
        MODEL_OPTIONS.map((model) => [model.id, model.id === "gpt-5.5"])
      ) as Record<ModelId, boolean>
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
      const runResults = await askQuestions(question.trim(), activeModels, allowMaybe);
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
          <p className="eyebrow">Constrained decoding game</p>
          <h1 id="app-title">It&apos;s a Simple Question...</h1>
          <p className="summary">
            Ask difficult questions to large language models and see what they really think. This tool uses
            constrained decoding to force the model to choose between &apos;Yes&apos; or &apos;No&apos; no matter
            what they are asked. Probabilities of either answer for each model are given in the sidebar on the
            right.
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
              <p className="model-hint">GPT-5.5 selected by default.</p>
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
          <p>Waiting for structured outputs from the selected models.</p>
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
          <p>Select at least one model, ask a question, and results will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="result-content">
      <div className="model-results">
        {results.map((run) =>
          run.ok ? <ModelResultCard key={run.model} result={run.result} /> : <ModelErrorCard key={run.model} model={run.model} error={run.error} />
        )}
      </div>
    </div>
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
