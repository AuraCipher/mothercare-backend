// Mock for the sharp native module — tracks resize calls

export let __resizeCalled = false;

export function __resetMockSharp() {
  __resizeCalled = false;
}

const sharp: any = (input?: any, opts?: any) => ({
  metadata: () => Promise.resolve({ width: 300, height: 300, format: 'jpeg' }),
  resize: (...args: any[]) => {
    __resizeCalled = true;
    return sharp(input, opts);
  },
  webp: () => sharp(input, opts),
  toBuffer: (options?: any) => {
    const buf = Buffer.from('mocked-image-data');
    if (options?.resolveWithObject) {
      return Promise.resolve({ data: buf, info: { width: 300, height: 300, format: 'webp', channels: 3, size: buf.length } });
    }
    return Promise.resolve(buf);
  },
  rotate: () => sharp(input, opts),
});

sharp.cache = () => {};

export default sharp;
