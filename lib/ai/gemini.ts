import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, USER_PROMPT } from "@/lib/prompt";

/**
 * Free-tier provider: Google's Gemini API (get a key at https://aistudio.google.com/apikey,
 * no payment method required). Used as the default provider so this project can be tried
 * end-to-end at zero cost — see AI_PROVIDER in .env.local to switch to Anthropic instead.
 *
 * Uses the newer `interactions.create` API surface (as opposed to the older
 * `models.generateContent`) — this is the current documented approach in the
 * `@google/genai` SDK as of this writing. Field names are snake_case
 * (system_instruction, mime_type, max_output_tokens) even though this is the
 * JS/TS SDK — verified against the SDK's own shipped type declarations.
 */
export async function convertWithGemini(base64: string, mimeType: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set on the server. Add it to .env.local and restart the dev server."
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  const interaction = await ai.interactions.create({
    model,
    system_instruction: SYSTEM_PROMPT,
    input: [
      { type: "text", text: USER_PROMPT },
      { type: "image", data: base64, mime_type: mimeType },
    ],
    generation_config: {
      max_output_tokens: 4096,
    },
  });

  const text = interaction.output_text;
  if (!text) {
    throw new Error("Gemini response did not contain any output text.");
  }
  return text;
}
