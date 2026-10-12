import { z } from "zod";
import { env } from "@/lib/env";
import { textCost, type TokenUsage } from "@/lib/pricing";
import { withRetry } from "@/lib/retry";
import { gemini, GenerationError, imagePart, textPart, type InputImage } from "./client";

export interface JsonResult<T> {
  data: T;
  usage: TokenUsage;
  costUsd: number;
  model: string;
}

/** Converts a Zod schema to the JSON Schema subset Gemini accepts. */
function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/**
 * Calls Gemini with structured output and validates the result with Zod.
 * Retries once on invalid JSON / schema mismatch, which is rare but happens.
 */
export async function generateJson<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  images?: InputImage[];
}): Promise<JsonResult<z.infer<S>>> {
  const model = env().GEMINI_TEXT_MODEL;
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const interaction = await withRetry("gemini text", () =>
      gemini().interactions.create({
        model,
        system_instruction: opts.system,
        input: [textPart(opts.prompt), ...(opts.images ?? []).map(imagePart)],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: toGeminiSchema(opts.schema),
        },
        // Thinking tokens are billed as output; ad copy doesn't need deep reasoning.
        generation_config: { thinking_level: "low" },
      }),
    );

    const u = interaction.usage;
    usage.inputTokens += u?.total_input_tokens ?? 0;
    // Thinking tokens are billed as output tokens.
    usage.outputTokens += (u?.total_output_tokens ?? 0) + (u?.total_thought_tokens ?? 0);

    try {
      const raw = interaction.output_text;
      if (!raw) throw new GenerationError("Model returned no text");
      const data = opts.schema.parse(JSON.parse(raw));
      return { data, usage, costUsd: textCost(model, usage), model };
    } catch (err) {
      lastError = err;
    }
  }

  throw new GenerationError(
    `Structured output failed after 2 attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
