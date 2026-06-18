// Mock for multer — supports file and body injection for upload tests

let mockFile: any = null;
let mockBody: Record<string, string> = {};

export function __setMockFile(file: any, body?: Record<string, string>) {
  mockFile = file;
  mockBody = body || {};
}

export function __resetMockFile() {
  mockFile = null;
  mockBody = {};
}

const memoryStorage = () => ({});
const diskStorage = () => ({});

const multer: any = () => ({
  single: (fieldName: string) => (req: any, res: any, next: any) => {
    if (mockFile) {
      req.file = mockFile;
      if (req.body) {
        Object.assign(req.body, mockBody);
      }
    }
    next();
  },
  array: () => (req: any, res: any, next: any) => next(),
  fields: () => (req: any, res: any, next: any) => next(),
  none: () => (req: any, res: any, next: any) => next(),
  any: () => (req: any, res: any, next: any) => next(),
});

multer.memoryStorage = memoryStorage;
multer.diskStorage = diskStorage;

export default multer;
