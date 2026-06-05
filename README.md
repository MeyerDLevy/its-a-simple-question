# It's a Simple Question

A small monorepo with:

- `apps/backend`: Express API that calls OpenRouter's Chat Completions API with strict Structured Outputs.
- `apps/frontend`: Vite React UI with a question input and Yes/No probability display.

The backend constrains the model output to this schema:

```json
{
  "type": "object",
  "properties": {
    "answer": { "type": "string", "enum": ["Yes", "No"] }
  },
  "required": ["answer"],
  "additionalProperties": false
}
```

It also requests `logprobs` and `top_logprobs` from OpenRouter, then extracts the log probabilities around the constrained enum token. The displayed probability is a normalized Yes-vs-No token probability from that generation step, not a calibrated truth score.

## Local setup

```bash
npm install
npm install --prefix apps/backend
npm install --prefix apps/frontend
cp apps/backend/.env.example apps/backend/.env
npm run dev
```

Add your API key to `apps/backend/.env`:

```bash
OPENROUTER_API_KEY=sk-or-...
```

Local URLs:

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:3001/health`

## Railway deployment

Create two Railway services from this repo.

Backend service:

- Root Directory: `/apps/backend`
- Build Command: `npm ci && npm run build`
- Start Command: `npm run start`
- Variables:
  - `OPENROUTER_API_KEY`
  - `OPENROUTER_MODEL` optional, defaults to `openai/gpt-4o-mini`
  - `OPENROUTER_SITE_URL` optional, your frontend public URL
  - `OPENROUTER_SITE_NAME` optional, defaults to `It's a Simple Question`
  - `CORS_ORIGIN` set to the frontend public URL after it is created

Frontend service:

- Root Directory: `/apps/frontend`
- Build Command: `npm ci && npm run build`
- Start Command: `npm run start`
- Variables:
  - `VITE_API_URL` set to the backend public URL
  - `VITE_STRIPE_DONATION_URL` optional, your Stripe donation link; the Donate button only shows when this is set

Railway injects `PORT`; both services read it automatically.

`VITE_*` variables are inlined at build time, so set them before `npm run build`. For local dev, add them to `apps/frontend/.env`:

```bash
VITE_STRIPE_DONATION_URL=https://donate.stripe.com/your-link
```
