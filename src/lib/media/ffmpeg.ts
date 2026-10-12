import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Thin FFmpeg wrappers. All functions take absolute paths and produce
 * H.264/AAC MP4 files with identical stream parameters, so normalized clips
 * can be concatenated without re-encoding.
 */

export const VIDEO_FPS = 30;
const AUDIO_RATE = 48_000;

function run(bin: "ffmpeg" | "ffprobe", args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) =>
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`${bin} not found. Install it with: brew install ffmpeg`)
          : err,
      ),
    );
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

const ffmpeg = (args: string[]) => run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);

const ENCODE_VIDEO = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"];
const ENCODE_AUDIO = ["-c:a", "aac", "-b:a", "160k", "-ar", String(AUDIO_RATE), "-ac", "2"];
const MP4_FLAGS = ["-movflags", "+faststart"];

export interface ProbeResult {
  durationSeconds: number;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<ProbeResult> {
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type",
    "-of", "json",
    file,
  ]);
  const json = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: { codec_type?: string }[];
  };
  return {
    durationSeconds: Number(json.format?.duration ?? 0),
    hasAudio: (json.streams ?? []).some((s) => s.codec_type === "audio"),
  };
}

/** Crops/scales to exactly width x height, fixes fps, and guarantees a stereo audio track. */
export async function normalizeClip(
  input: string,
  output: string,
  size: { width: number; height: number },
): Promise<void> {
  const { hasAudio } = await probe(input);
  const vf = `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},fps=${VIDEO_FPS},setsar=1`;
  const args = hasAudio
    ? ["-i", input, "-vf", vf, "-map", "0:v:0", "-map", "0:a:0"]
    : [
        "-i", input,
        "-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
        "-vf", vf, "-map", "0:v:0", "-map", "1:a:0", "-shortest",
      ];
  await ffmpeg([...args, ...ENCODE_VIDEO, ...ENCODE_AUDIO, ...MP4_FLAGS, output]);
}

/** Turns a still image into a silent clip (used for end cards). */
export async function imageToClip(
  png: string,
  output: string,
  seconds: number,
): Promise<void> {
  await ffmpeg([
    "-loop", "1", "-framerate", String(VIDEO_FPS), "-t", String(seconds), "-i", png,
    "-f", "lavfi", "-t", String(seconds), "-i", `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
    "-map", "0:v:0", "-map", "1:a:0",
    "-vf", "setsar=1",
    ...ENCODE_VIDEO, ...ENCODE_AUDIO, ...MP4_FLAGS,
    output,
  ]);
}

/**
 * Turns a still into a slow push-in clip (free alternative to a Veo shot),
 * with a silent audio track so it concatenates with normalized clips.
 */
export async function stillToMotionClip(
  png: string,
  output: string,
  seconds: number,
  size: { width: number; height: number },
): Promise<void> {
  const frames = Math.round(seconds * VIDEO_FPS);
  // Upscale first so the zoom doesn't jitter; zoom 1.0 -> ~1.10 over the clip.
  const vf =
    `scale=${size.width * 2}:${size.height * 2}:force_original_aspect_ratio=increase,` +
    `crop=${size.width * 2}:${size.height * 2},` +
    `zoompan=z='1+0.10*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${size.width}x${size.height}:fps=${VIDEO_FPS},setsar=1`;
  await ffmpeg([
    "-loop", "1", "-i", png,
    "-f", "lavfi", "-t", String(seconds), "-i", `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
    "-vf", vf, "-frames:v", String(frames),
    "-map", "0:v:0", "-map", "1:a:0", "-shortest",
    ...ENCODE_VIDEO, ...ENCODE_AUDIO, ...MP4_FLAGS,
    output,
  ]);
}

/** Concatenates normalized clips (same codec parameters) without re-encoding. */
export async function concatClips(inputs: string[], output: string): Promise<void> {
  const listFile = path.join(path.dirname(output), `${path.basename(output)}.txt`);
  const escape = (p: string) => p.replace(/'/g, "'\\''");
  await writeFile(listFile, inputs.map((p) => `file '${escape(p)}'`).join("\n"));
  try {
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", ...MP4_FLAGS, output]);
  } finally {
    await rm(listFile, { force: true });
  }
}

export interface TimedOverlay {
  png: string;
  start: number;
  end: number;
}

/** Composites full-frame transparent PNGs on top of the video during their time windows. */
export async function burnOverlays(
  input: string,
  overlays: TimedOverlay[],
  output: string,
): Promise<void> {
  if (overlays.length === 0) {
    await ffmpeg(["-i", input, "-c", "copy", output]);
    return;
  }
  const inputs = overlays.flatMap((o) => ["-i", o.png]);
  const filters: string[] = [];
  let last = "0:v";
  overlays.forEach((o, i) => {
    const out = i === overlays.length - 1 ? "vout" : `v${i}`;
    filters.push(
      `[${last}][${i + 1}:v]overlay=0:0:enable='between(t,${o.start.toFixed(3)},${o.end.toFixed(3)})'[${out}]`,
    );
    last = out;
  });
  await ffmpeg([
    "-i", input, ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "0:a?",
    ...ENCODE_VIDEO, "-c:a", "copy", ...MP4_FLAGS,
    output,
  ]);
}

/**
 * Lays a voiceover over the clip's own audio, which is kept quietly as an
 * ambience bed. Output length always matches the video.
 */
export async function mixVoiceover(
  video: string,
  voiceover: string,
  output: string,
  opts: { delaySeconds: number; bedVolume: number },
): Promise<void> {
  const delayMs = Math.round(opts.delaySeconds * 1000);
  await ffmpeg([
    "-i", video, "-i", voiceover,
    "-filter_complex",
    `[0:a]volume=${opts.bedVolume}[bed];` +
      `[1:a]aresample=${AUDIO_RATE},aformat=channel_layouts=stereo,adelay=${delayMs}|${delayMs}[vo];` +
      `[bed][vo]amix=inputs=2:duration=first:normalize=0[aout]`,
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", ...ENCODE_AUDIO, ...MP4_FLAGS,
    output,
  ]);
}

/** Generates a JPEG poster frame for the gallery. */
export async function posterFrame(video: string, output: string, atSeconds = 1): Promise<void> {
  await ffmpeg(["-ss", String(atSeconds), "-i", video, "-frames:v", "1", "-q:v", "3", output]);
}
