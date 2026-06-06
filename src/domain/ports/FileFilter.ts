/**
 * Filter that determines which files should be included in indexing.
 */
export interface FileFilter {
  formats: string[];
  include?: string[];
  exclude?: string[];
  shouldInclude(path: string): boolean;
}
