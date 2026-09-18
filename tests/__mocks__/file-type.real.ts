/**
 * Real file-type passthrough for jest.media.config.js. The main jest config
 * maps 'file-type' to a deterministic stub; these media tests need actual
 * magic-byte sniffing.
 *
 * Two constraints shape this file:
 * 1. file-type v21 is ESM-only: a static import fails under ts-jest/CommonJS,
 *    so the real library runs in a `node --input-type=module` child.
 * 2. The child must be addressed by a specifier that does NOT match this
 *    very mapper ('^file-type$') — importing the bare specifier recurses
 *    until the heap explodes (observed). Hence subprocess + cwd resolution.
 * 3. Bytes travel over STDIN, never argv (Linux MAX_ARG_STRLEN kills large
 *    buffers with E2BIG — observed with a 168 KB PNG).
 */
import { execFileSync } from 'child_process';

export function fileTypeFromBuffer(
  buffer: Uint8Array,
): Promise<{ ext: string; mime: string } | undefined> {
  return Promise.resolve().then(() => {
    const script = `
      const [{ fileTypeFromBuffer }] = await Promise.all([import('file-type')]);
      let text = '';
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) text += chunk;
      const type = await fileTypeFromBuffer(Buffer.from(text.trim(), 'base64'));
      process.stdout.write(JSON.stringify(type ?? null));
    `;
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        input: Buffer.from(buffer).toString('base64'),
        maxBuffer: 1024 * 1024,
        timeout: 30000,
        cwd: process.cwd(),
      },
    ).toString();
    const parsed = JSON.parse(out || 'null');
    return parsed == null ? undefined : { ext: parsed.ext, mime: parsed.mime };
  });
}

export function FileTypeParser(...args: unknown[]) {
  throw new Error('FileTypeParser is not available in media-test bridge');
}
