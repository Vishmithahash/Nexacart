# NexaCart Local Ollama Integration Guide (Windows / Team Setup)

This guide documents how every team member runs NexaCart against their local Ollama instance using the shared repository integration code.

---

## 1. Prerequisites & Key Principles

- **Identical Codebase**: All four members use the exact same committed code. Machine-specific settings live in each member's ignored `.env` file.
- **Local Isolation**: Each team member runs their own Ollama server locally. No member's IP address, credentials, or Windows user paths are hardcoded.
- **Meaning of `localhost`**: `localhost` refers to the machine running the NestJS backend process. If Ollama runs on the same computer as the backend, `http://localhost:11434` connects directly over loopback.
- **Docker Environments**: If running NexaCart inside Docker while Ollama runs on the Windows host, configure `OLLAMA_BASE_URL="http://host.docker.internal:11434"`.
- **No API Key Required**: Local Ollama inference does not require an API key (`OPENAI_API_KEY` is not required when `LLM_PROVIDER=ollama`).
- **Git Does Not Distribute Models**: Git synchronizes source code only. It does not distribute the Ollama binary or model weights. Updating `.env` alone does not install or download the model.
- **Application Startup Decoupling**: Model downloading and Ollama availability checks are intentionally excluded from normal NestJS application startup. If Ollama is temporarily stopped or unreachable, all standard ecommerce endpoints (catalog, cart, checkout, payments, etc.) will start and function normally.
- **Security & Network Safety**: Keep Ollama bound to localhost (`127.0.0.1:11434`). Do not expose Ollama publicly to the internet or change Windows firewall rules to allow external incoming connections.

---

## 2. Step-by-Step Setup Instructions

### Step a: Install and Start Ollama on Windows

1. Download and install Ollama from [https://ollama.com/download/windows](https://ollama.com/download/windows).
2. Start Ollama. Once started, the Ollama llama icon will appear in the Windows system tray.

### Step b: Pull the Qwen 3.5 4B Model

Open PowerShell or Command Prompt and download `qwen3.5:4b`:

```powershell
ollama pull qwen3.5:4b
```

Verify that the model was downloaded successfully:

```powershell
ollama list
```

You should see `qwen3.5:4b` in the list of installed models.

### Step c: Verify the Local Ollama HTTP API

Verify that the local HTTP server is listening and returning the installed model:

```powershell
curl http://localhost:11434/api/tags
```

You should receive a JSON response listing `qwen3.5:4b` with tools capability.

### Step d: Pull the Shared NexaCart Changes

Pull the latest code from Git:

```powershell
git pull origin test
```

### Step e: Configure Local `.env`

In your local `backend/.env` file (which is git-ignored), **preserve your existing database (`DATABASE_URL`), JWT secrets, and port settings**, and add/update the following LLM variables:

```env
# ── LLM Agent & Provider ────────────────────────────────────────────
LLM_PROVIDER=ollama
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL="qwen3.5:4b"
OLLAMA_REQUEST_TIMEOUT_MS=180000
OLLAMA_NUM_CTX=8192

# Agent execution limits
AGENT_MAX_STEPS=10
AGENT_MAX_TOOL_CALLS=20
AGENT_MAX_INSTRUCTION_LENGTH=2000
AGENT_RUN_TIMEOUT_MS=60000
```

> **Note on `OLLAMA_NUM_CTX`**: 8192 is an initial configurable context size setting for local inference. It does not guarantee that infinitely long chat histories will fit. Adjust if your system has higher/lower VRAM capacity.

### Step f: Restart the NexaCart Backend

From the `backend` directory, start the development server:

```powershell
npm run start:dev
```

Verify that the NestJS server starts cleanly on `http://localhost:3000`.

### Step g: Test the Authenticated Agent Endpoint

The agent endpoint requires authentication with the `CUSTOMER` role. Follow these steps:

1. Log in or register as a customer to get a JWT token:
   ```powershell
   # Example login:
   curl -X POST http://localhost:3000/api/v1/auth/login `
     -H "Content-Type: application/json" `
     -d '{"email":"customer@example.com","password":"Password123!"}'
   ```
   Save the returned `accessToken`.

2. Trigger an agent run with a read-only instruction:
   ```powershell
   curl -X POST http://localhost:3000/api/v1/agent/runs `
     -H "Content-Type: application/json" `
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN_HERE" `
     -d '{"instruction":"Search for headphones in the store"}'
   ```

3. Check the response:
   - Status: `200 OK`
   - `provider`: `"OLLAMA"`
   - `model`: `"qwen3.5:4b"`
   - `status`: `"COMPLETED"`
   - `finalAnswer`: Contains natural language answer referencing actual store products
   - `toolCalls`: Contains ordered record of executed tools (`search_products`) with parameters and actual result envelope.
