import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  Box,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { SourceData } from "../types";
import { ContentView } from "./ContentView";

interface ChunkViewerProps {
  chunks: SourceData[];
  activeIndex?: number;
  onSelect?: (index: number) => void;
}

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  return `${(chars / 1024).toFixed(1)} KB`;
}

function chunkLanguage(chunk: SourceData): string | undefined {
  const language = chunk.metadata?.language;
  return typeof language === "string" ? language : undefined;
}

export function ChunkViewer({ chunks, activeIndex, onSelect }: ChunkViewerProps) {
  const focusRef = useRef<HTMLDivElement | null>(null);
  const active = Math.min(
    Math.max(0, activeIndex ?? 0),
    Math.max(0, chunks.length - 1),
  );

  useEffect(() => {
    if (chunks.length === 0) return;
    focusRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, chunks.length]);

  if (chunks.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No chunks found.
      </Typography>
    );
  }

  const current = chunks[active]!;
  const currentLanguage = chunkLanguage(current);
  const totalChars = chunks.reduce(
    (sum, chunk) => sum + Math.max(1, chunk.content.length),
    0,
  );

  const select = (index: number) => {
    if (!onSelect) return;
    onSelect(Math.max(0, Math.min(index, chunks.length - 1)));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onSelect) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      select(active - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      select(active + 1);
    }
  };

  return (
    <Box
      className="chunk-navigator"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Chunk navigator"
    >
      <Stack spacing={1.1}>
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <Box>
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", letterSpacing: "0.1em", textTransform: "uppercase" }}
            >
              Chunk navigator
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {chunks.length} chunks · {formatSize(totalChars)} total · use ← →
            </Typography>
          </Box>

          <Stack direction="row" spacing={0.4} sx={{ alignItems: "center" }}>
            <Typography variant="caption" sx={{ color: "#8DF4FF", fontWeight: 700 }}>
              {active + 1} / {chunks.length}
            </Typography>
            <IconButton
              size="small"
              disabled={active <= 0}
              onClick={() => select(active - 1)}
              aria-label="Previous chunk"
            >
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              size="small"
              disabled={active >= chunks.length - 1}
              onClick={() => select(active + 1)}
              aria-label="Next chunk"
            >
              <ChevronRightIcon />
            </IconButton>
          </Stack>
        </Stack>

        <Box className="chunk-distribution" role="group" aria-label="Select chunk">
          {chunks.map((chunk, index) => {
            const isActive = index === active;
            return (
              <Tooltip
                key={chunk.id}
                title={`Chunk ${index + 1} · ${formatSize(chunk.content.length)}${
                  isActive ? " · current" : ""
                }`}
                placement="top"
              >
                <Box
                  component="button"
                  type="button"
                  className={isActive ? "chunk-segment is-active" : "chunk-segment"}
                  aria-label={`Chunk ${index + 1} of ${chunks.length}`}
                  aria-pressed={isActive}
                  onClick={() => select(index)}
                  sx={{ flexGrow: Math.max(1, chunk.content.length) }}
                />
              </Tooltip>
            );
          })}
        </Box>

        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          <Box className="legend-dot" />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            current
          </Typography>
          <Box className="legend-dot is-muted" />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            other chunks
          </Typography>
        </Stack>

        <Box className="chunk-focus" ref={focusRef}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mb: 0.75, alignItems: "center", justifyContent: "space-between" }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Typography variant="body2" sx={{ color: "#ffffff", fontWeight: 700 }}>
                Chunk {active + 1}
              </Typography>
              <Chip size="small" label={current.type} />
              {current.embeddings.length > 0 && (
                <Chip size="small" label={`${current.embeddings.length}d`} sx={{ color: "#00DBFF" }} />
              )}
            </Stack>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {formatSize(current.content.length)}
            </Typography>
          </Stack>
          <Box className="chunk-focus-content">
            <ContentView
              content={current.content}
              type={current.type}
              {...(currentLanguage ? { language: currentLanguage } : {})}
            />
          </Box>
        </Box>

        <Stack spacing={0.4} className="chunk-list">
          {chunks.map((chunk, index) => {
            const isActive = index === active;
            const firstLine = chunk.content.split("\n").find((line) => line.trim()) ?? "";
            return (
              <Box
                key={chunk.id}
                component="button"
                type="button"
                className={isActive ? "chunk-list-row is-active" : "chunk-list-row"}
                onClick={() => select(index)}
                aria-current={isActive ? "true" : undefined}
                title={`Chunk ${index + 1} · ${formatSize(chunk.content.length)}`}
              >
                <Typography variant="caption" sx={{ color: isActive ? "#8DF4FF" : "#8FA3AD", fontWeight: 700 }}>
                  #{index + 1}
                </Typography>
                <span className="chunk-list-preview">{firstLine || "(blank line)"}</span>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {formatSize(chunk.content.length)}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      </Stack>
    </Box>
  );
}
