/**
 * M5 — media queue/worker contract tests (no Redis required).
 *
 * Proves: job payload shape (references only, never bytes), worker noop
 * without Redis, retryable-vs-permanent mapping (UnrecoverableError), and
 * R2 multipart classifier additions.
 */
import { UnrecoverableError } from 'bullmq';
import {
  buildMediaJobData,
  getMediaQueue,
  isMediaQueueEnabled,
  MEDIA_PROCESS_JOB,
  MEDIA_QUEUE_NAME,
} from '../../../src/queues/media.queue';
import { startMediaWorker } from '../../../src/queues/media.worker';
import { classifyProviderError } from '../../../src/modules/upload/storage/multipart-storage';

describe('media queue', () => {
  test('job data carries references only — never bytes', () => {
    const data = buildMediaJobData('file-1');
    expect(data).toEqual({ fileRecordId: 'file-1', processingVersion: 1 });
    expect(JSON.stringify(data).length).toBeLessThan(256);
    expect(MEDIA_QUEUE_NAME).toBe('media');
    expect(MEDIA_PROCESS_JOB).toBe('media_process');
  });

  test('disabled without Redis (test env has none)', () => {
    expect(isMediaQueueEnabled()).toBe(false);
    expect(getMediaQueue()).toBeNull();
    expect(startMediaWorker()).toBeNull();
  });
});

describe('media worker mapping (no Redis)', () => {
  const PROCESSOR = '../../../src/modules/media/media-processor';
  const WORKER = '../../../src/queues/media.worker';

  afterEach(() => {
    jest.dontMock(PROCESSOR);
    jest.resetModules();
  });

  test('retryable processor failure propagates (queue retries)', async () => {
    jest.resetModules();
    jest.doMock(PROCESSOR, () => ({
      processMediaFile: jest.fn().mockRejectedValue(
        Object.assign(new Error('r2 503'), { retryable: true }),
      ),
    }));
    const { handleMediaProcess: handle } = require(WORKER);
    await expect(handle({ fileRecordId: 'f', processingVersion: 1 })).rejects.toMatchObject({
      message: 'r2 503',
    });
  });

  test('permanent processor failure becomes UnrecoverableError (no retry)', async () => {
    jest.resetModules();
    jest.doMock(PROCESSOR, () => ({
      processMediaFile: jest.fn().mockRejectedValue(
        Object.assign(new Error('too long'), { status: 422, retryable: false }),
      ),
    }));
    const { handleMediaProcess: handle } = require(WORKER);
    // NOTE: resetModules loads a second bullmq copy — compare against the
    // fresh class object, not the file-top import.
    const { UnrecoverableError: FreshUE } = require('bullmq');
    const err = await handle({ fileRecordId: 'f', processingVersion: 1 }).then(
      () => null,
      (e: any) => e,
    );
    expect(err).toBeInstanceOf(FreshUE);
    expect(err.message).toMatch(/too long/);
  });
});

describe('R2 multipart classifier — M5 additions', () => {
  test.each([
    [{ name: 'InvalidPart' }, { retryable: false, notFound: false }],
    [{ name: 'InvalidPartOrder' }, { retryable: false, notFound: false }],
    [{ name: 'EntityTooSmall' }, { retryable: false, notFound: false }],
    [{ name: 'TooManyRequestsException' }, { retryable: true, notFound: false }],
    [{ $metadata: { httpStatusCode: 429 } }, { retryable: true, notFound: false }],
    [{ name: 'NoSuchUpload' }, { retryable: false, notFound: true }],
    [{ name: 'TimeoutError' }, { retryable: true, notFound: false }],
  ])('%p → %p', (err, expected) => {
    expect(classifyProviderError(err)).toMatchObject(expected);
  });
});
