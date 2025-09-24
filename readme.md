📦 inoculation-chatbot/

├── 📂 lib/

│   └── 📄 openaiHeaders.ts          # Shared helper for OpenAI API headers

├── 📂 pages/

│   ├── 📄 index.tsx                 # Main UI (mic button, pulsing ring, logs, CSV, replay)

│   └── 📂 api/

│       ├── 📄 chat.ts               # Chat completion endpoint

│       ├── 📄 health.ts             # Health check (basic API test)

│       ├── 📄 health_chat.ts        # Health check for Chat Completions

│       ├── 📄 models.ts             # List available models

│       ├── 📄 transcribe.ts         # Speech-to-text (audio → text)

│       └── 📄 tts.ts                # Text-to-speech (NPC reply → audio)

│
├── 📂 public/

│   └── 📄 favicon.ico

├── 📄 next.config.js

├── 📄 package.json

├── 📄 tsconfig.json

└── 📄 readme.md
