// Mock for the sharp native module — tracks resize calls

export let __resizeCalled = false;

export function __resetMockSharp() {
  __resizeCalled = false;
}

const sharp: any = () => ({
  metadata: () => Promise.resolve({ width: 300, height: 300, format: 'jpeg' }),
  resize: (...args: any[]) => {
    __resizeCalled = true;
    return sharp();
  },
  webp: () => sharp(),
  toBuffer: () => Promise.resolve(Buffer.from('mocked-image-data')),
  rotate: () => sharp(),
});

sharp.cache = () => {};

export default sharp;
