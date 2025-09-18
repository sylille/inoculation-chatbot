Inoculation NPC — Audio Roleplay (Next.js + OpenAI)

Audio-first NPC that listens to your mic, transcribes speech, roleplays an ERI-style inoculation against political manipulation tactics, and speaks back via browser TTS. Built for Vercel.

Project file order 
inoculation-chatbot/
├─ README.md
├─ package.json
├─ next.config.js
├─ tsconfig.json
├─ .env.example
├─ pages/
│  ├─ index.tsx
│  └─ api/
│     ├─ chat.ts
│     └─ transcribe.ts
└─ public/
   └─ favicon.ico   (optional)

Features

🎙️ mic → /api/transcribe → OpenAI STT → text

🤝 text → /api/chat → OpenAI LLM → ERI-style reply

🔊 reply → browser TTS (no extra key)

🧱 simple system prompt you can tune for your study

🧪 TypeScript + Pages Router, Vercel-ready

1) Requirements

Node 18.17+ (Vercel uses Node 18 on serverless)

An OpenAI API key with access to:

Chat model (e.g., gpt-4o-mini)

Speech-to-Text model (e.g., whisper-1 or your org’s STT model)

2) Setup

Clone & install:

git clone <your-repo-url> inoculation-chatbot
cd inoculation-chatbot
npm install


Create env file:

cp .env.example .env.local
# then edit .env.local and paste your key(s)


.env.example

# Required
OPENAI_API_KEY=sk-...

# Optional (defaults to https://api.openai.com)
# OPENAI_API_BASE=https://api.openai.com


Run locally:

npm run dev
# open http://localhost:3000

3) Deploy to Vercel

Push to GitHub.

Vercel → “New Project” → import repo.

Project Settings → Environment Variables

OPENAI_API_KEY = your key

(Optional) OPENAI_API_BASE

Deploy.

4) How it works

pages/index.tsx: UI + microphone capture (MediaRecorder) + browser TTS.

pages/api/transcribe.ts: accepts multipart audio file and sends to OpenAI audio/transcriptions (using Node 18’s fetch, FormData, File).

pages/api/chat.ts: sends the conversation (system + user/assistant turns) to chat/completions and returns the assistant text.

Default models (change as needed):

STT: whisper-1

Chat: gpt-4o-mini

5) Important files
package.json (key parts)

Uses Next 14 and Node 18 features.

No node-fetch / no multer required.

next.config.js

Disables bodyParser for API routes (we use formidable).

Adds a webpack rule for audio assets (optional).

tsconfig.json

Includes "lib": ["dom", "dom.iterable", "es2022"] so Blob/File/FormData work on server.

6) Customize the NPC (system prompt)

Open pages/index.tsx → the initial messages state contains the system prompt. Tweak ERI tone, length, tactics (e.g., cherry-picking, false cause), and your study’s micro-actions.

7) Switching voices (TTS)

We use browser speechSynthesis for simplicity. If you need consistent voices across devices, add a server TTS route that returns an audio URL and play it in the client. (You can later add /api/tts and store/stream audio from memory or the filesystem.)

8) Realtime (optional, advanced)

For lowest latency (live partial transcripts and tokens), integrate OpenAI Realtime over WebRTC. That requires:

An endpoint to create short-lived Realtime sessions

A client RTCPeerConnection + getUserMedia to stream mic audio

Handling partial tokens → streaming TTS

This repo sticks to simple upload → transcribe → chat → TTS for reliability.

9) Accessibility & UX tips

Show a recording indicator and a big push-to-talk button.

Provide a “repeat last reply” button (re-trigger TTS).

For older adults, keep replies short, avoid jargon, and read at normal pace (utter.rate = 1.0).

Consider large fonts and high-contrast buttons.

10) Privacy & IRB notes

Voice is uploaded to your /api/transcribe function and forwarded to OpenAI STT.

Inform users in consent that third-party processing occurs.

Consider redacting PII in logs; avoid storing raw audio unless required.

Add a visible “Clear Conversation” button (it’s included as Reset).

11) Troubleshooting

Build fails with multer or node-fetch
→ We don’t use them. Remove from package.json. Use Node 18 global fetch, and Web FormData/File.

500 from /api/transcribe

Check Vercel Function Logs (it will forward the OpenAI error).

Verify OPENAI_API_KEY is set on Vercel (Production env).

Model errors: switch whisper-1 to the STT model your org supports.

TypeScript errors about Blob/File/FormData

Ensure tsconfig.json has "lib": ["dom", "dom.iterable", "es2022"].

Our transcribe.ts uses new Uint8Array(buffer) to satisfy types.

No audio playing

Browser may block autoplay; user must click before TTS.

Try Chrome desktop first. Call speechSynthesis.getVoices() after a user gesture.

Mic permission fails

HTTPS required in production. On localhost, your browser should still allow mic.

Make sure you call navigator.mediaDevices.getUserMedia({ audio: true }) from a gesture (button).

12) API details
POST /api/transcribe

Form-data field: audio (webm blob)

Returns: { text: string }

POST /api/chat

JSON: { messages: Array<{ role: "system"|"user"|"assistant"; content: string }> }

Returns: { text: string }

13) Model/Cost guardrails

Keep prompts short.

Limit max_tokens on /api/chat (current: 800).

Consider per-session message caps for budget control.

14) Roadmap ideas (drop-in later)

✅ Server TTS route with a consistent neural voice

✅ Streaming chat (Server-Sent Events) for progressive display

✅ Realtime (WebRTC) for live ASR + partial tokens

✅ “Technique cards” UI: highlight detected manipulation tactic with a one-line definition