# SERP API Integration for OpenCodex

OpenCodex supports multiple high-quality search providers via SERP APIs. This provides the agent with structured, reliable search results instead of relying solely on web scraping.

## Supported Providers

### 1. Serper.dev

[Serper](https://serper.dev) is a fast and cost-effective Google Search API.

- **Environment Variable:** `SERPER_API_KEY`
- **Config Key:** `serpApiKey` (in `~/.codex/config.json`)
- **Endpoint:** `https://google.serper.dev/search`

### 2. SerpApi.com

[SerpApi](https://serpapi.com) is a comprehensive search engine API supporting multiple engines (Google, Bing, Baidu, etc.).

- **Environment Variable:** `SERPAPI_API_KEY`
- **Endpoint:** `https://serpapi.com/search.json`

## Configuration

You can configure your API key in two ways:

### Method 1: Environment Variables (Recommended for CLI)

Add the following to your `~/.zshrc`, `~/.bashrc`, or `.env` file:

```bash
# For Serper.dev
export SERPER_API_KEY="your_serper_key_here"

# OR for SerpApi.com
export SERPAPI_API_KEY="your_serpapi_key_here"
```

### Method 2: Global Configuration File

Edit your `~/.codex/config.json`:

```json
{
  "serpApiKey": "your_serper_key_here"
}
```

### Method 3: In-Session UI

1. Press `Ctrl + O` during a chat session.
2. Navigate to **SERP API KEY**.
3. Paste your key and press **Enter**.
4. The key is applied immediately and saved to your config file.

## Search Priority Logic

When the agent performs a `web_search` or `browse` command, it selects a provider in this order:

1. **SearXNG**: If `searxngUrl` is configured.
2. **SerpApi.com**: If `SERPAPI_API_KEY` is present.
3. **Serper.dev**: If `SERPER_API_KEY` or `serpApiKey` (config) is present.
4. **DuckDuckGo**: Default fallback using `lynx -dump` (no API key required).

## Benefits

- **Higher Signal**: Structured JSON data provides cleaner snippets than raw HTML scraping.
- **Reliability**: Avoids bot detection/CAPTCHAs common with scraping.
- **Speed**: Direct API calls are typically faster than rendering/dumping HTML pages.

## Troubleshooting

### 403 Unauthorized

If you see a `403` error in the logs:

- Verify your API key has remaining credits.
- Ensure you are using the correct environment variable for your provider (e.g., don't use a SerpApi.com key with `SERPER_API_KEY`).

### No logs about search

Run the app with `DEBUG=true` to see detailed logs about which search provider is being selected and any error messages from the APIs.
