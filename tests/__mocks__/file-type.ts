// Mock for file-type — configurable per test
let mockResult: { ext: string; mime: string } | null = { ext: 'webp', mime: 'image/webp' };

export function __setFileTypeResult(result: { ext: string; mime: string } | null) {
  mockResult = result;
}

export const fileTypeFromBuffer = () => mockResult ? Promise.resolve(mockResult) : Promise.resolve(undefined);
export const FileTypeParser = () => ({});
