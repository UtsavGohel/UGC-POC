import { env } from "@/lib/env";
import { ttsCost } from "@/lib/pricing";
import { withRetry } from "@/lib/retry";
import { gemini, GenerationError } from "./client";

export interface SpeechResult {
  /** WAV file bytes (24 kHz, mono, 16-bit PCM). */
  wav: Buffer;
  costUsd: number;
  model: string;
}

export async function generateSpeech(opts: {
  text: string;
  style: string;
  voice?: string;
}): Promise<SpeechResult> {
  const model = env().GEMINI_TTS_MODEL;

  const interaction = await withRetry("gemini tts", () =>
    gemini().interactions.create({
    model,
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: opts.text,
            annotations: [{ type: "speech_metadata", style: opts.style }],
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: {
      speech_config: [{ voice: opts.voice ?? "Kore" }],
    },
    }),
  );

  const audio = interaction.output_audio;
  if (!audio?.data) throw new GenerationError("TTS model returned no audio");

  const u = interaction.usage;
  return {
    wav: Buffer.from(audio.data, "base64"),
    costUsd: ttsCost(model, {
      inputTokens: u?.total_input_tokens ?? 0,
      outputTokens: u?.total_output_tokens ?? 0,
    }),
    model,
  };
}
