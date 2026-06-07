# Dental Booking AI

A clean starter scaffold for a dental appointment booking tool with email webhook intake and AI-based parsing.

## Setup

```bash
npm install
npm run dev:server
npm run dev:client
```

Set required environment variables before starting the backend:

```bash
export MAILGUN_API_KEY="your-mailgun-api-key"
export OPENAI_API_KEY="your-openai-api-key"   # optional, enables follow-up and LLM parsing
export PORT=4174
```

Open `http://localhost:4173` for the frontend. The backend listens on `http://localhost:4174`.
