import env from '../../config/env';

export function buildFileServeUrl(fileId: string): string {
  const base =
    env.APP_URL ||
    env.FRONTEND_URL ||
    `http://${env.HOST}:${env.PORT}`;
  return `${base.replace(/\/$/, '')}/api/uploads/${fileId}`;
}
