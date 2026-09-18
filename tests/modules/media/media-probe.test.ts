/**
 * M5 — ffprobe wrapper unit tests.
 *
 * Parsing/normalization logic is tested with stubbed runners (deterministic).
 * Real-binary behavior is tested with hand-crafted fixtures (no ffmpeg
 * needed to BUILD them; the real ffprobe binary inspects them).
 */
import {
  probeDurationSeconds,
  probeHasStream,
  probeMedia,
  probeVideoDimensions,
} from '../../../src/modules/media/media-probe';
import { mp4Seconds, mp4NoMoov, wavSeconds } from './fixtures';

const ffprobeOk = (stdout: string) => async () => ({ stdout, stderr: '' });

describe('probeMedia — parsing and classification', () => {
  test('parses streams, durations, container', async () => {
    const out = await probeMedia('/tmp/x.mp4', {
      runner: ffprobeOk(
        JSON.stringify({
          format: { format_name: 'mov,mp4', duration: '5.04', size: '1234' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, duration: '5.0' },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }),
      ),
    });
    expect(out.container).toMatch(/mov/);
    expect(out.durationSeconds).toBeCloseTo(5.04);
    expect(out.streams).toHaveLength(2);
    expect(probeHasStream(out, 'video')).toBe(true);
    expect(probeHasStream(out, 'audio')).toBe(true);
    expect(probeVideoDimensions(out)).toEqual({ width: 1280, height: 720 });
  });

  test('duration prefers the max of format + streams; rejects garbage', async () => {
    const out = await probeMedia('/tmp/x.mp4', {
      runner: ffprobeOk(
        JSON.stringify({
          format: { duration: 'N/A' },
          streams: [{ codec_type: 'audio', duration: '12.5' }],
        }),
      ),
    });
    expect(probeDurationSeconds(out)).toBeCloseTo(12.5);
  });

  test('missing/invalid durations normalize to undefined (never NaN)', async () => {
    for (const duration of ['N/A', 'Infinity', '-inf', '-5', undefined]) {
      const out = await probeMedia('/tmp/x.mp4', {
        runner: ffprobeOk(JSON.stringify({ format: { duration }, streams: [] })),
      });
      expect(probeDurationSeconds(out)).toBeUndefined();
    }
  });

  test('zero-dimension video yields no dimensions (not zeros)', async () => {
    const out = await probeMedia('/tmp/x.mp4', {
      runner: ffprobeOk(
        JSON.stringify({
          format: {},
          streams: [{ codec_type: 'video', width: 0, height: 0 }],
        }),
      ),
    });
    expect(probeVideoDimensions(out)).toBeUndefined();
    expect(probeHasStream(out, 'video')).toBe(true);
  });

  test('unparseable stdout is retryable infrastructure failure (502)', async () => {
    await expect(probeMedia('/tmp/x.mp4', { runner: ffprobeOk('not json{{{') })).rejects.toMatchObject({
      status: 502,
      retryable: true,
    });
  });

  test('timeout is retryable; corrupt media is permanent 422', async () => {
    const timeoutErr: any = new Error('timed out');
    timeoutErr.killed = true;
    await expect(
      probeMedia('/tmp/x.mp4', {
        runner: async () => {
          throw timeoutErr;
        },
      }),
    ).rejects.toMatchObject({ status: 502, retryable: true });

    const corrupt: any = new Error('Invalid data found');
    corrupt.code = 1;
    await expect(
      probeMedia('/tmp/x.mp4', {
        runner: async () => {
          throw corrupt;
        },
      }),
    ).rejects.toMatchObject({ status: 422, retryable: false });

    const missing: any = new Error('spawn ENOENT');
    missing.code = 'ENOENT';
    await expect(
      probeMedia('/tmp/x.mp4', {
        runner: async () => {
          throw missing;
        },
      }),
    ).rejects.toMatchObject({ status: 502, retryable: true });
  });
});

describe('probeMedia — real binary on hand-crafted fixtures', () => {
  test('600s mp4 boundary reads exactly', async () => {
    const file = `/tmp/m5-probe-${process.pid}-600.mp4`;
    require('fs').writeFileSync(file, mp4Seconds(600));
    try {
      const out = await probeMedia(file);
      expect(out.durationSeconds).toBeCloseTo(600, 3);
    } finally {
      require('fs').unlinkSync(file);
    }
  });

  test('601s mp4 reads over the cap (enforcement is the processor’s job)', async () => {
    const file = `/tmp/m5-probe-${process.pid}-601.mp4`;
    require('fs').writeFileSync(file, mp4Seconds(601));
    try {
      const out = await probeMedia(file);
      expect(probeDurationSeconds(out)!).toBeGreaterThan(600);
    } finally {
      require('fs').unlinkSync(file);
    }
  });

  test('moov-less mp4 is uninspectable → permanent 422 (never treated as 0s)', async () => {
    const file = `/tmp/m5-probe-${process.pid}-nomoov.mp4`;
    require('fs').writeFileSync(file, mp4NoMoov());
    try {
      // ffprobe exits non-zero (moov atom not found): the wrapper must
      // reject rather than report a usable (zero) duration.
      await expect(probeMedia(file)).rejects.toMatchObject({ status: 422 });
    } finally {
      require('fs').unlinkSync(file);
    }
  });

  test('garbage bytes are permanent 422, not a hang', async () => {
    const file = `/tmp/m5-probe-${process.pid}-garbage.mp4`;
    require('fs').writeFileSync(file, Buffer.from('this is not media at all, just text bytes here'));
    try {
      await expect(probeMedia(file)).rejects.toMatchObject({ status: 422 });
    } finally {
      require('fs').unlinkSync(file);
    }
  });

  test('hand WAV reports exact audio duration', async () => {
    const file = `/tmp/m5-probe-${process.pid}.wav`;
    require('fs').writeFileSync(file, wavSeconds(599));
    try {
      const out = await probeMedia(file);
      expect(probeHasStream(out, 'audio')).toBe(true);
      expect(probeDurationSeconds(out)).toBeCloseTo(599, 1);
    } finally {
      require('fs').unlinkSync(file);
    }
  });
});
