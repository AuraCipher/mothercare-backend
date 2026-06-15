// Mock for the sharp native module

const sharp: any = () => ({
  metadata: () => Promise.resolve({ width: 300, height: 300, format: 'jpeg' }),
  resize: () => sharp(),
  webp: () => sharp(),
  toBuffer: () => Promise.resolve(Buffer.from('mocked-image-data')),
  rotate: () => sharp(),
});

sharp.cache = () => {};

export default sharp;
