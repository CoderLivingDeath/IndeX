import { useMemo } from "react";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { SourceType } from "../types";

interface ContentViewProps {
  content: string;
  type: SourceType;
  language?: string;
}

function highlightCode(content: string, language?: string): string {
  if (language) {
    const normalised = language.toLowerCase();
    if (hljs.getLanguage(normalised)) {
      try {
        return hljs.highlight(content, { language: normalised }).value;
      } catch {
        // fall through to auto-detection
      }
    }
  }
  return hljs.highlightAuto(content).value;
}

export function ContentView({ content, type, language }: ContentViewProps) {
  const isMarkdown = type === "markdown" || type === "obsidian";

  const html = useMemo(() => {
    if (isMarkdown) {
      const raw = marked.parse(content, { async: false }) as string;
      return DOMPurify.sanitize(raw);
    }
    return highlightCode(content, language);
  }, [content, isMarkdown, language]);

  if (isMarkdown) {
    return (
      <div
        className="md-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className="code-block">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
