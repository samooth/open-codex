import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config();

async function testEmbeddings() {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    console.error("GEMINI_API_KEY not found");
    return;
  }

  const genAI = new GoogleGenAI({ apiKey });
  const model = "text-embedding-004";
  
  console.log(`Testing Google Embeddings with model: ${model}`);
  
  try {
    const text = "Hello, this is a test for Google embeddings.";
    const result = await (genAI as any).models.embedContent({
      model,
      contents: text
    });
    const embedding = result.embeddings?.[0]?.values || result.embedding?.values || (Array.isArray(result.embeddings) ? result.embeddings[0] : result.embeddings);
    
    console.log(`Successfully generated embedding!`);
    console.log(`Dimensions: ${embedding.length}`);
    console.log(`First 5 values: ${embedding.slice(0, 5)}`);
  } catch (error) {
    console.error("Error generating embedding:", error);
  }
}

testEmbeddings();
