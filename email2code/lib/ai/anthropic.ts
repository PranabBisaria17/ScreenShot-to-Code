import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, USER_PROMPT } from "@/lib/prompt";

/**
 * Paid provider: Anthropic's Claude API. This is what the feasibility test in
 * docs/feasibility-notes.md validated. Switch AI_PROVIDER=anthropic in
 * .env.local (and set ANTHROPIC_API_KEY) once you're ready to move off the
 * free Gemini tier — e.g. for production quality or higher volume.
 */
export async function convertWithAnthropic(base64: string, mimeType: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set on the server. Add it to .env.local and restart the dev server."
    );
  }

  const anthropic = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/png" | "image/jpeg" | "image/webp",
              data: base64,
            },
          },
          { type: "text", text: USER_PROMPT },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model response did not contain a text block.");
  }
  return textBlock.text;
}
