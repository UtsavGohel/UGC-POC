import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/env";

let client: GoogleGenAI | undefined;

export function gemini(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: env().GEMINI_API_KEY });
  return client;
}

export interface InputImage {
  data: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export function imagePart(image: InputImage) {
  return {
    type: "image" as const,
    mime_type: image.mimeType,
    data: image.data.toString("base64"),
  };
}

export function textPart(text: string) {
  return { type: "text" as const, text };
}

/** Error raised when the model returns nothing usable (safety block, empty output). */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}
