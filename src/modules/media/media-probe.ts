/**
 * M5 — authoritative media probing via ffprobe.
 *
 * Safety contract (§11):
 * - execFile with an argument ARRAY (never a shell string): a malicious
 *   filename can never become executable syntax.
 * - Binary path comes from the ffprobe-static package (install-time,
 *   content-addressed), never from user input or env.
 * - Probed target is either a server-side local path (validated inside the
 *   uploads root) or a server-minted presigned R2 URL (short-lived).
 * - Bounded wall clock (MEDIA_PROBE_TIMEOUT_MS, SIGKILL), bounded stdout
 *   (1 MiB), stderr truncated for logs (never raw in responses).
 */
import { execFile } from 'child_process';
import env from '../../config/env';

// ffprobe-static ships no types; the export shape is { path: string }.
const ffprobePath: string = (
  require('ffprobe-static') as { path: string }
).path;

function probeTimeoutMs(): number {
  const ms = Number(process.env.MEDIA_PROBE_TIMEOUT_MS ?? env.MEDIA_PROBE_TIMEOUT_MS ?? 60000);
  return Number.isFinite(ms) && ms > 0 ? ms : 60000;
}

export interface ProbedStream {
  kind: string; // 'video' | 'audio' | 'subtitle' | ...
  codec?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface ProbeResult {
  container?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  streams: ProbedStream[];
}

export type ProbeRunner = (
  target: string,
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: ProbeRunner = (target, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', target],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          (err as any).probeStderr = String(stderr ?? '').slice(0, 2000);
          reject(err);
          return;
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '').slice(0, 2000) });
      },
    );
  });

function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parseProbeJson(stdout: string): ProbeResult {
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw { status: 502, message: 'Media probe returned unreadable output', retryable: true };
  }
  const streams: ProbedStream[] = Array.isArray(parsed?.streams)
    ? parsed.streams.map((s: any) => ({
        kind: typeof s?.codec_type === 'string' ? s.codec_type : 'unknown',
        codec: typeof s?.codec_name === 'string' ? s.codec_name : undefined,
        width: num(s?.width),
        height: num(s?.height),
        durationSeconds: num(s?.duration),
      }))
    : [];
  return {
    container: typeof parsed?.format?.format_name === 'string' ? parsed.format.format_name : undefined,
    durationSeconds: num(parsed?.format?.duration),
    sizeBytes: num(parsed?.format?.size),
    streams,
  };
}

/**
 * Probe a media file. Resolves stream/duration facts; throws classified
 * errors: {status:422} permanent (unreadable/corrupt output), {status:502,
 * retryable:true} infrastructure (timeout/spawn failure).
 */
export async function probeMedia(
  target: string,
  opts: { runner?: ProbeRunner; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? probeTimeoutMs();
  const runner = opts.runner ?? defaultRunner;
  let out: { stdout: string; stderr: string };
  try {
    out = await runner(target, timeoutMs);
  } catch (err: any) {
    if (err?.killed || /timed out|ETIMEDOUT|timeout/i.test(err?.message || '')) {
      throw {
        status: 502,
        message: 'Media probe timed out',
        retryable: true,
        probeStderr: err?.probeStderr,
      };
    }
    // ffprobe exit != 0 with output usually means corrupt/unsupported media,
    // but a spawn failure (ENOENT) is infrastructure — distinguish them.
    if (err?.code === 'ENOENT') {
      throw { status: 502, message: 'Media probe unavailable', retryable: true };
    }
    throw {
      status: 422,
      message: 'Media file could not be inspected',
      retryable: false,
      probeStderr: err?.probeStderr,
    };
  }
  return parseProbeJson(out.stdout);
}

/**
 * Authoritative duration in seconds, or undefined when absent/invalid.
 * Explicit normalization (§13): rejects NaN/Infinity/negatives; zero means
 * "no measurable duration" (caller decides whether that is acceptable).
 */
export function probeDurationSeconds(result: ProbeResult): number | undefined {
  const candidates = [
    result.durationSeconds,
    ...result.streams.map((s) => s.durationSeconds),
  ].filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  if (candidates.length === 0) return undefined;
  return Math.max(...candidates);
}

export function probeHasStream(result: ProbeResult, kind: 'video' | 'audio'): boolean {
  return result.streams.some((s) => s.kind === kind);
}

export function probeVideoDimensions(
  result: ProbeResult,
): { width: number; height: number } | undefined {
  const video = result.streams.find(
    (s) => s.kind === 'video' && s.width != null && s.height != null && s.width > 0 && s.height > 0,
  );
  if (!video?.width || !video?.height) return undefined;
  return { width: video.width, height: video.height };
}
