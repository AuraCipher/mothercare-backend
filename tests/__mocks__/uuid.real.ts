/**
 * Real UUIDs for jest.media.config.js (Node crypto.randomUUID, RFC 4122 v4).
 * The main config maps 'uuid' to a constant stub; media tests need unique
 * storage keys. crypto is sync, unlike ESM dynamic import.
 */
import { randomUUID } from 'crypto';

export function v4(): string {
  return randomUUID();
}

export function v5(): string {
  return randomUUID();
}
