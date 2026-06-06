/**
 * A hasher that produces a string digest from input data.
 */
export interface Hasher {
  hash(data: string | Uint8Array): Promise<string>;
  readonly algorithm: string;
}

/**
 * Estimates token count for a given text under a specific model's tokenizer.
 */
export interface TokenEstimator {
  estimate(text: string): Promise<number>;
  readonly model: string;
}
