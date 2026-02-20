# SearXNG Integration for OpenCodex

This document describes the integration of SearXNG as a search provider for the OpenCodex agent.

## Implementation Details

### 1. Configuration
A new configuration option `searxngUrl` has been added to the global OpenCodex configuration.
- **Config Key:** `searxngUrl`
- **Environment Variable Support:** Can be set in `~/.codex/config.json`.
- **Default:** If not set, the agent falls back to DuckDuckGo via `lynx`.

Example `~/.codex/config.json`:
```json
{
  "searxngUrl": "https://search.yourdomain.com"
}
```

### 2. Tool Enhancement: `web_search`
The `handleWebSearch` tool now follows this logic:
1. **Check for `searxngUrl`**: If present, it attempts a JSON API request to `${searxngUrl}/search?q=${query}&format=json` using `curl`.
2. **Process JSON**: It extracts the top 10 results (Title, URL, and Content/Snippet) and formats them into a clean, token-efficient string for the agent.
3. **Graceful Fallback**: If the SearXNG request fails, the instance is unreachable, or the response is not valid JSON, it automatically falls back to the legacy DuckDuckGo scraping method using `lynx -dump`.

### 3. Benefits
- **Structured Data**: Provides high-signal snippets instead of raw text dumps.
- **Privacy**: Allows the use of self-hosted search instances.
- **Reliability**: JSON APIs are significantly more stable than scraping HTML from DuckDuckGo.

## Verification
To verify the integration:
1. Ensure `curl` is installed on your system.
2. Set a valid `searxngUrl` in your config.
3. Ask OpenCodex to search for something real-time.
4. Check debug logs (`DEBUG=true`) to see the SearXNG request and response.
