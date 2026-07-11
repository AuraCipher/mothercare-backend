/** Relative path — clients prepend their own API origin (mobile uses API_BASE_URL). */
export function buildFileServeUrl(fileId: string): string {
  return `/api/uploads/${fileId}`;
}
