// Mock for multer

const memoryStorage = () => ({});
const diskStorage = () => ({});

const multer: any = () => ({
  single: () => (req: any, res: any, next: any) => next(),
  array: () => (req: any, res: any, next: any) => next(),
  fields: () => (req: any, res: any, next: any) => next(),
  none: () => (req: any, res: any, next: any) => next(),
  any: () => (req: any, res: any, next: any) => next(),
});

multer.memoryStorage = memoryStorage;
multer.diskStorage = diskStorage;

export default multer;
