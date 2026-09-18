/**
 * M5 — hand-crafted media fixtures (no ffmpeg needed to BUILD them).
 *
 * MP4: ftyp + moov(mvhd + optional trak(tkhd + mdia(mdhd + hdlr))).
 * Duration lives in mvhd (timescale 1000). Lean traks (no minf/stbl) still
 * expose codec_type via hdlr — verified against the real ffprobe binary.
 * WAV: 44-byte RIFF header + PCM payload; duration = data/byteRate.
 */
function box(type: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + payload.length);
  return Buffer.concat([size, Buffer.from(type), payload]);
}

function ftyp(): Buffer {
  return box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isom'), Buffer.from('mp42')]));
}

function mvhd(timescale: number, duration: number): Buffer {
  const body = Buffer.alloc(100);
  body.writeUInt32BE(timescale, 12);
  body.writeUInt32BE(duration, 16);
  return box('mvhd', body);
}

/** Minimal video/audio track. omitMinf is always true (lean, parseable). */
function trak(handler: 'vide' | 'soun', timescale: number, duration: number, width = 0, height = 0): Buffer {
  const mdhd = Buffer.alloc(32);
  mdhd.writeUInt32BE(timescale, 12);
  mdhd.writeUInt32BE(duration, 16);
  const hdlr = Buffer.concat([Buffer.alloc(8), Buffer.from(handler), Buffer.alloc(12)]);
  const mdia = box('mdia', Buffer.concat([box('mdhd', mdhd), box('hdlr', hdlr)]));
  const tkhd = Buffer.alloc(92);
  tkhd[3] = 7;
  // tkhd v0: width at payload offset 76, height at 80 (16.16 fixed-point).
  if (width > 0) tkhd.writeUInt32BE(width * 65536, 76);
  if (height > 0) tkhd.writeUInt32BE(height * 65536, 80);
  return box('trak', Buffer.concat([box('tkhd', tkhd), mdia]));
}

export function mp4Seconds(
  seconds: number,
  opts: { handler?: 'vide' | 'soun'; timescale?: number; width?: number; height?: number; withTrack?: boolean } = {},
): Buffer {
  const timescale = opts.timescale ?? 1000;
  const duration = Math.round(seconds * timescale);
  const withTrack = opts.withTrack ?? true;
  const parts = [ftyp()];
  const moovParts = [mvhd(timescale, duration)];
  if (withTrack) {
    moovParts.push(
      trak(opts.handler ?? 'vide', timescale, duration, opts.width ?? 0, opts.height ?? 0),
    );
  }
  parts.push(box('moov', Buffer.concat(moovParts)));
  return Buffer.concat(parts);
}

/** ftyp only — container with no moov (duration missing). */
export function mp4NoMoov(): Buffer {
  return ftyp();
}

/** PCM WAV of exactly `seconds` (header-declared == real). */
export function wavSeconds(
  seconds: number,
  opts: { sampleRate?: number; channels?: number; bitsPerSample?: number } = {},
): Buffer {
  const sampleRate = opts.sampleRate ?? 8000;
  const channels = opts.channels ?? 1;
  const bits = opts.bitsPerSample ?? 8;
  const byteRate = Math.floor((sampleRate * channels * bits) / 8);
  const dataLen = Math.floor(seconds * byteRate);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(Math.floor((channels * bits) / 8), 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, Buffer.alloc(dataLen, 0x80)]);
}

/** WAV with a LIED data size (header claims more than present). */
export function wavLyingHeader(declaredSeconds: number, actualSeconds: number): Buffer {
  const full = wavSeconds(declaredSeconds);
  const actualLen = Math.floor(actualSeconds * 8000);
  return full.subarray(0, 44 + actualLen);
}
