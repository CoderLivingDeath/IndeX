import type { Embedder, EmbedderRegistry } from "../../domain/systems/EmbeddingSystem";

/**
 * A config-driven embedder registry that routes source types
 * to the correct models by priority, with universal model support.
 *
 * Usage:
 * ```ts
 * const registry = new EmbedderRegistryImpl();
 * registry.register("typescript", tsEmbedder, 1);
 * registry.register("*", universalEmbedder, 10);  // universal fallback
 * ```
 */
export class EmbedderRegistryImpl implements EmbedderRegistry {
  private readonly modelMap: Map<string, Array<{ embedder: Embedder; priority: number }>> = new Map();

  /**
   * Creates a new registry, optionally pre-populated from model entries.
   *
   * @param entries - Optional list of model entries. If source_types is absent
   *                  or empty, the model is registered as universal ("*").
   */
  constructor(entries?: Array<{
    model: string;
    embedder: Embedder;
    source_types?: string[];
    priority: number;
  }>) {
    if (entries) {
      for (const entry of entries) {
        const types = entry.source_types && entry.source_types.length > 0
          ? entry.source_types
          : ["*"];
        for (const sourceType of types) {
          this.register(sourceType, entry.embedder, entry.priority);
        }
      }
    }
  }

  /**
   * Returns the embedder with the lowest priority for the given source type,
   * or the universal model (registered with "*") if no specific match is found.
   *
   * @param sourceType - The source type to look up
   * @returns The matching embedder, or null if none is found
   */
  getEmbedder(sourceType: string): Embedder | null {
    // Prefer exact matches over universal
    const exact = this.modelMap.get(sourceType);
    if (exact && exact.length > 0) {
      const sorted = [...exact].sort((a, b) => a.priority - b.priority);
      return sorted[0]!.embedder;
    }

    // Fall back to universal with lowest priority
    const universal = this.modelMap.get("*");
    if (universal && universal.length > 0) {
      const sorted = [...universal].sort((a, b) => a.priority - b.priority);
      return sorted[0]!.embedder;
    }

    return null;
  }

  /**
   * Returns all embedders that support the given source type,
   * ordered by priority ascending. Falls back to universal models
   * (registered with "*") if no specific matches are found.
   *
   * @param sourceType - The source type to look up
   * @returns Array of matching embedders, sorted by priority
   */
  getEmbedders(sourceType: string): Embedder[] {
    const results: Array<{ embedder: Embedder; priority: number }> = [];
    const seen = new Set<Embedder>();

    // Collect exact matches
    const exact = this.modelMap.get(sourceType);
    if (exact) {
      for (const entry of exact) {
        seen.add(entry.embedder);
        results.push(entry);
      }
    }

    // Always include universal models (but avoid duplicates)
    const universal = this.modelMap.get("*");
    if (universal) {
      for (const entry of universal) {
        if (!seen.has(entry.embedder)) {
          results.push(entry);
        }
      }
    }

    // Sort by priority ascending
    results.sort((a, b) => a.priority - b.priority);

    return results.map((entry) => entry.embedder);
  }

  /**
   * Returns the universal model (registered with sourceType "*"),
   * or null if none is registered.
   */
  getUniversalEmbedder(): Embedder | null {
    const universal = this.modelMap.get("*");
    if (!universal || universal.length === 0) return null;
    // Return the one with lowest priority (copy before sort to avoid mutation)
    const sorted = [...universal].sort((a, b) => a.priority - b.priority);
    return sorted[0]!.embedder;
  }

  /**
   * Checks whether any embedders are registered.
   */
  isAvailable(): boolean {
    return this.modelMap.size > 0;
  }

  /**
   * Registers an embedder for the given source type with a priority.
   * Lower priority values take precedence.
   *
   * @param sourceType - The source type (use "*" for universal fallback)
   * @param embedder - The embedder instance
   * @param priority - Lower values = higher priority
   */
  register(sourceType: string, embedder: Embedder, priority: number): void {
    const existing = this.modelMap.get(sourceType) ?? [];
    existing.push({ embedder, priority });
    this.modelMap.set(sourceType, existing);
  }

  /**
   * Returns the list of unique model names registered across all source types.
   */
  get modelNames(): string[] {
    const names = new Set<string>();
    for (const entries of this.modelMap.values()) {
      for (const entry of entries) {
        names.add(entry.embedder.model);
      }
    }
    return Array.from(names);
  }
}
