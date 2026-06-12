// ---------------------------------------------------------------------------
// astGrepDynamic — Dynamic language registration for @ast-grep/napi
//
// Registers non-built-in languages (Python, JSON, etc.) via
// registerDynamicLanguage(). Must be called exactly once before any parse().
// ---------------------------------------------------------------------------

import { registerDynamicLanguage } from "@ast-grep/napi";
import pythonRegistration from "@ast-grep/lang-python";
import jsonRegistration from "@ast-grep/lang-json";

let initialized = false;

/**
 * Register all dynamic languages with @ast-grep/napi.
 * Safe to call multiple times — only registers once.
 */
export function initDynamicLanguages(): void {
  if (initialized) return;

  registerDynamicLanguage({
    python: {
      libraryPath: pythonRegistration.libraryPath,
      extensions: pythonRegistration.extensions as unknown as string[],
    },
    json: {
      libraryPath: jsonRegistration.libraryPath,
      extensions: jsonRegistration.extensions as unknown as string[],
    },
  });

  initialized = true;
}

/**
 * Map of file extension → ast-grep language name (for parse()).
 * Includes both built-in Lang and dynamic languages.
 */
export const EXTENSION_LANG_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "python",
  ".json": "json",
};

/**
 * Get the ast-grep language name for a file path.
 * Falls back to "TypeScript" for unknown extensions.
 */
export function getLanguageForFile(path: string): string {
  for (const [ext, lang] of Object.entries(EXTENSION_LANG_MAP)) {
    if (path.endsWith(ext)) return lang;
  }
  return "TypeScript";
}
