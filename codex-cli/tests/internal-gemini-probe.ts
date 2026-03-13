
/**
 * Internal Gemini API Probe
 * 
 * This script tests the unofficial Cloud Code endpoint discovered in the logs:
 * https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
 * 
 * Note: This likely requires a full Google Cloud OAuth2 token rather than 
 * a standard API Key, but we'll probe both.
 */

import "dotenv/config";

const ENDPOINT = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const API_KEY = process.env.GEMINI_API_KEY || "";

async function probe() {
  console.log(`Probing internal endpoint: ${ENDPOINT}`);
  
  if (!API_KEY) {
    console.error("Error: GEMINI_API_KEY not found in environment.");
    return;
  }

  // Standard Gemini Payload
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: "Hello, identify yourself and your version." }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens: 1024,
    }
  };

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Trying API Key as a query param (common for Google APIs)
        // or via x-goog-api-key header
        "x-goog-api-key": API_KEY,
        "User-Agent": "GeminiCLI/0.33.0/gemini-3-pro-preview (linux; x64)",
        "x-goog-api-client": "gl-node/22.14.0"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`HTTP Error ${response.status}: ${response.statusText}`);
      console.error("Response Body:", errorText);
      
      if (response.status === 401 || response.status === 403) {
        console.warn("\nNote: This endpoint likely requires OAuth2 authentication, not just an API key.");
      }
      return;
    }

    console.log("Connection successful! Streaming response...\n");

    const reader = response.body?.getReader();
    if (!reader) {
      console.error("Error: Response body is null.");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // SSE format is data: { ...JSON... } followed by double newline
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const jsonStr = line.slice(5).trim();
          if (jsonStr === "[DONE]") {
            console.log("\n[Stream Complete]");
            break;
          }
          
          try {
            const data = JSON.parse(jsonStr);
            // Internal API might have slightly different schema than public
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text 
                      || data.text 
                      || "";
            process.stdout.write(text);
          } catch (e) {
            // Might be a partial JSON or non-JSON line
            // console.debug("Skipping line:", line);
          }
        }
      }
    }
  } catch (err) {
    console.error("Connection failed:", err);
  }
}

probe();
