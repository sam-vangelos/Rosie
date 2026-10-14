export const TRIAGE_BATCH_MAX_REQUESTS = 1000;
export const SCORE_BATCH_MAX_REQUESTS = 200;
export const SCORE_BATCH_MAX_BASE64_BYTES = 50 * 1024 * 1024;

export type BatchStage = 'triage' | 'score';

export function makeBatchCustomId(localId: string, candidateId: string): string {
  const customId = `${localId}_${candidateId}`;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(customId)) {
    throw new Error(`Invalid Anthropic custom_id for candidate: ${candidateId}`);
  }
  return customId;
}

export function parseBatchCustomId(customId: string, localId: string): string {
  if (customId.slice(0, 36) !== localId || customId[36] !== '_') {
    throw new Error(`Unexpected custom_id in batch ${localId}: ${customId}`);
  }
  return customId.slice(37);
}

export function chunkStageItems<T extends { artifact_byte_size: number }>(
  stage: BatchStage,
  items: T[]
): T[][] {
  const maxRequests = stage === 'triage'
    ? TRIAGE_BATCH_MAX_REQUESTS
    : SCORE_BATCH_MAX_REQUESTS;
  const chunks: T[][] = [];
  let chunk: T[] = [];
  let chunkBytes = 0;

  for (const item of items) {
    const itemBytes = stage === 'score' ? Math.ceil(item.artifact_byte_size / 3) * 4 : 0;
    if (itemBytes > SCORE_BATCH_MAX_BASE64_BYTES) {
      throw new Error('A score batch item exceeds the 50MB base64 limit');
    }
    if (
      chunk.length > 0 &&
      (chunk.length >= maxRequests || chunkBytes + itemBytes > SCORE_BATCH_MAX_BASE64_BYTES)
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(item);
    chunkBytes += itemBytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
