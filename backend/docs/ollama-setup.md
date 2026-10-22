# NexaCart Local Ollama Integration Guide (Windows / Team Setup)

This guide documents how every team member runs NexaCart against their local Ollama instance using the shared repository integration code.

---

## 1. Prerequisites & Key Principles

- **Identical Codebase**: All team members use the exact same committed code. Machine-specific settings live in each member's ignored `.env` file.
- **Local Isolation**: Each team member runs their own Ollama server locally. No member's IP address, credentials, or Windows user paths are hardcoded.
- **Addressing (`localhost` vs Docker)**:
  - When running the NestJS backend directly on the Windows host, `localhost` refers to loopback on that machine. `http://localhost:11434` connects directly to local Ollama.
  - When running NexaCart inside a Docker container while Ollama runs on the Windows host, `localhost` inside the container resolves to the container itself, not the Windows host. Configure `OLLAMA_BASE_URL="http://host.docker.internal:11434"` so the container can reach the host-bound Ollama daemon.
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

### Step c: Verify the Local Ollama HTTP API & Model Capabilities

1. Check that the local HTTP daemon is listening:
   ```powershell
   curl.exe -s http://localhost:11434/api/tags
   ```
   > **Important**: The `/api/tags` endpoint lists models installed locally on disk; **it does not prove tool-calling capability**.

2. Verify model details and function-calling capability through the model-info endpoint:
   ```powershell
   curl.exe -s -X POST http://localhost:11434/api/show -d '{\"name\":\"qwen3.5:4b\"}'
   ```
   Inspect the output capabilities or test with a structured tool smoke test.

### Step d: Pull the Shared NexaCart Changes & Install Dependencies

Follow the team's established branch-update process for your working branch (e.g. pull your active feature or integration branch):

```powershell
git pull
```

Install backend dependencies matching the committed lockfile:

```powershell
npm ci
```

### Step e: Configure Local `.env`

In your local `backend/.env` file (which is git-ignored), **preserve your existing database (`DATABASE_URL`), JWT secrets, and port settings**, and add or update the LLM configuration:

```env
# ── Local Ollama Configuration ──────────────────────────────────────
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_REQUEST_TIMEOUT_MS=180000
OLLAMA_NUM_CTX=8192
AGENT_RUN_TIMEOUT_MS=180000
AGENT_MAX_STEPS=10
AGENT_MAX_TOOL_CALLS=20
```

> **Application Defaults vs Configured Values**:
> - The application built-in default for `AGENT_RUN_TIMEOUT_MS` is `60000` (60 seconds) if omitted.
> - Setting `AGENT_RUN_TIMEOUT_MS=180000` (3 minutes) in `.env` is recommended for local models running on CPU or modest GPUs, aligning the total agent execution budget with the per-request timeout `OLLAMA_REQUEST_TIMEOUT_MS=180000`.
> - `OLLAMA_NUM_CTX=8192` provides a working context window for tool-calling turns. Adjust if your system has higher or lower VRAM capacity.

### Step f: Restart the NexaCart Backend

From the `backend` directory, start the development server:

```powershell
npm run start:dev
```

Verify that the NestJS server starts cleanly on `http://localhost:3000`.

### Step g: Test the Authenticated Agent Endpoint

The agent endpoint requires authentication with the `CUSTOMER` role. Use PowerShell (`Invoke-RestMethod`) or `curl.exe`:

#### Option 1: Windows PowerShell (Recommended)

1. Log in to obtain your JWT access token (reads the actual `{ accessToken, refreshToken, user }` response):
   ```powershell
   $login = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/auth/login" `
     -Method Post `
     -ContentType "application/json" `
     -Body (@{ email = "customer@example.com"; password = "Password123!" } | ConvertTo-Json)

   $token = $login.accessToken
   ```

2. Trigger an agent run with a read-only instruction:
   ```powershell
   $body = @{ instruction = "Search for headphones in the store" } | ConvertTo-Json

   $run = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/agent/runs" `
     -Method Post `
     -Headers @{ Authorization = "Bearer $token" } `
     -ContentType "application/json" `
     -Body $body

   $run | ConvertTo-Json -Depth 5
   ```

#### Option 2: Windows Command Prompt / curl.exe

```powershell
# 1. Login
curl.exe -s -X POST http://localhost:3000/api/v1/auth/login `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"customer@example.com\",\"password\":\"Password123!\"}"

# 2. Run agent (substitute YOUR_ACCESS_TOKEN)
curl.exe -s -X POST http://localhost:3000/api/v1/agent/runs `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" `
  -d "{\"instruction\":\"Search for headphones in the store\"}"
```

3. Expected Response:
   - Status: `200 OK`
   - `provider`: `"OLLAMA"`
   - `model`: `"qwen3.5:4b"`
   - `status`: `"COMPLETED"`
   - `finalAnswer`: Contains natural language answer referencing actual store products
   - `toolCalls`: Contains ordered record of executed tools (`search_products`) with parameters and actual result envelope.

