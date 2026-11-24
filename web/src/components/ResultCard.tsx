import { useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DataObjectIcon from "@mui/icons-material/DataObject";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LayersIcon from "@mui/icons-material/Layers";
import type { SearchResult, SourceData } from "../types";
import { api } from "../api";
import { ContentView } from "./ContentView";
import { ChunkViewer } from "./ChunkViewer";
import { AstTree } from "./AstTree";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMetaValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "object" ? JSON.stringify(item) : String(item),
      )
      .join(", ");
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface ResultCardProps {
  result: SearchResult;
  query?: string;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Compact, clickable position map of chunks within the file. */
function ChunkMap({
  total,
  current,
  onSelect,
}: {
  total: number;
  current: number;
  onSelect?: (index: number) => void;
}) {
  const count = Math.max(1, total);
  const active = Math.min(Math.max(0, current), count - 1);
  const maxVisible = 12;
  const start =
    count > maxVisible
      ? Math.max(0, Math.min(active - Math.floor(maxVisible / 2), count - maxVisible))
      : 0;
  const shown = Array.from(
    { length: Math.min(maxVisible, count) },
    (_, index) => start + index,
  );

  return (
    <Stack direction="row" spacing={0.35} sx={{ alignItems: "center" }}>
      {start > 0 && (
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.6rem" }}>
          …
        </Typography>
      )}
      {shown.map((index) => (
        <Box
          key={index}
          component="button"
          type="button"
          title={`Chunk ${index + 1} of ${count}`}
          aria-label={`Open chunk ${index + 1} of ${count}`}
          onClick={onSelect ? () => onSelect(index) : undefined}
          sx={{
            width: 9,
            height: 5,
            p: 0,
            border: 0,
            borderRadius: 99,
            cursor: onSelect ? "pointer" : "default",
            background:
              index === active
                ? "linear-gradient(90deg, #00DBFF, #8DF4FF)"
                : "rgba(143, 163, 173, 0.24)",
            boxShadow:
              index === active ? "0 0 8px rgba(0, 219, 255, 0.65)" : "none",
            transition: "background 160ms ease, box-shadow 160ms ease",
            "&:hover": {
              background:
                index === active
                  ? "linear-gradient(90deg, #00DBFF, #8DF4FF)"
                  : "rgba(0, 219, 255, 0.55)",
            },
          }}
        />
      ))}
      {start + shown.length < count && (
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.6rem" }}>
          …
        </Typography>
      )}
      <Typography
        variant="caption"
        sx={{ color: "#8DF4FF", ml: 0.4, fontSize: "0.68rem", fontWeight: 600 }}
      >
        {active + 1}/{count}
      </Typography>
    </Stack>
  );
}

const MATCH_COLORS: Record<string, string> = {
  keyword: "#8DF4FF",
  semantic: "#22d3ee",
  hybrid: "#00DBFF",
  ast: "#FFC857",
};

function scoreColor(score: number): string {
  if (score >= 0.8) return "#8DF4FF";
  if (score >= 0.5) return "#00DBFF";
  return "#FFC857";
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box className="session-row">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </Box>
  );
}

export function ResultCard({ result, query = "" }: ResultCardProps) {
  const { source } = result;
  const lines = source.content.split("\n").length;
  const scorePercent = Math.round(result.score * 100);

  const matchedTerms = useMemo(() => {
    const content = source.content.toLowerCase();
    return Array.from(
      new Set(
        query
          .toLowerCase()
          .split(/\s+/)
          .filter((term) => term.length > 1 && content.includes(term)),
      ),
    ).slice(0, 4);
  }, [query, source.content]);
  const [open, setOpen] = useState(false);
  const [chunks, setChunks] = useState<SourceData[] | null>(null);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksError, setChunksError] = useState<string | null>(null);
  const [selectedChunk, setSelectedChunk] = useState(source.chunk_index);
  const [copied, setCopied] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);
  const [astOpen, setAstOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const metadata = source.metadata ?? {};
  const language =
    typeof metadata.language === "string" ? metadata.language : undefined;
  const ast = metadata.ast;
  const astCounts = {
    symbols: ast?.symbols?.length ?? 0,
    imports: ast?.imports?.length ?? 0,
    exports: ast?.exports?.length ?? 0,
  };
  const hasAst = astCounts.symbols + astCounts.imports + astCounts.exports > 0;

  const chars = source.content.length;
  const bytes = new TextEncoder().encode(source.content).length;
  const embeddingNorm = Math.sqrt(
    source.embeddings.reduce((sum, value) => sum + value * value, 0),
  );
  const embeddingPreview = source.embeddings
    .slice(0, 8)
    .map((value) => value.toFixed(3))
    .join(", ");

  const metaEntries = Object.entries(metadata).filter(
    ([key, value]) => key !== "ast" && value !== undefined && value !== null,
  );

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(source.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard may be unavailable outside a secure context
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setJsonCopied(true);
      window.setTimeout(() => setJsonCopied(false), 1200);
    } catch {
      // clipboard may be unavailable outside a secure context
    }
  };

  const loadChunks = async (preferred?: number) => {
    setChunksLoading(true);
    setChunksError(null);
    try {
      const data = await api.source(source.source_id);
      if (data.error) {
        setChunksError(data.error);
        return;
      }
      setChunks(data.chunks);
      const target = preferred ?? source.chunk_index;
      setSelectedChunk(
        Math.max(0, Math.min(target, Math.max(0, data.chunks.length - 1))),
      );
    } catch (err) {
      setChunksError(err instanceof Error ? err.message : String(err));
    } finally {
      setChunksLoading(false);
    }
  };

  const openChunk = (index: number) => {
    setOpen(true);
    setSelectedChunk(index);
    if (!chunks && !chunksLoading) void loadChunks(index);
  };

  const matchColor = MATCH_COLORS[result.match_type] ?? "#00DBFF";

  return (
    <Box className="result-card">
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.9} sx={{ alignItems: "center", minWidth: 0 }}>
            <Box
              sx={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                flexShrink: 0,
                background: matchColor,
                boxShadow: `0 0 10px ${matchColor}`,
              }}
            />
            <Typography
              className="result-title"
              title={fileName(source.path)}
              sx={{ fontWeight: 700, fontSize: "0.92rem", minWidth: 0 }}
            >
              {fileName(source.path)}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", flexShrink: 0, whiteSpace: "nowrap" }}
            >
              {source.type}
              {language ? ` · ${language}` : ""}
            </Typography>
          </Stack>

          <Typography className="result-path" title={source.path} sx={{ mt: 0.35 }}>
            {source.path}
          </Typography>
        </Box>

        <Stack direction="row" spacing={0.6} sx={{ alignItems: "center", flexShrink: 0 }}>
          <Box sx={{ textAlign: "right" }}>
            <Typography
              sx={{
                color: scoreColor(result.score),
                fontWeight: 800,
                fontSize: "1.02rem",
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
              }}
              title={`Cosine/BM25 relevance: ${result.score.toFixed(4)}`}
            >
              {scorePercent}%
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: matchColor,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontSize: "0.58rem",
                fontWeight: 700,
              }}
            >
              {result.match_type}
            </Typography>
          </Box>
          <Tooltip title={copied ? "Copied" : "Copy path"}>
            <IconButton className="copy-btn" size="small" onClick={copyPath}>
              <ContentCopyIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={jsonCopied ? "Copied" : "Copy full result JSON"}>
            <IconButton className="copy-btn" size="small" onClick={copyJson}>
              <DataObjectIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Box className={open ? "result-snippet is-open" : "result-snippet"}>
        <ContentView
          content={source.content}
          type={source.type}
          {...(language ? { language } : {})}
        />
      </Box>

      <Stack
        direction="row"
        spacing={1.25}
        sx={{
          mt: 0.55,
          pt: 0.55,
          borderTop: "1px solid #12262F",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Stack direction="row" spacing={0.8} sx={{ alignItems: "center" }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              browse
            </Typography>
            <ChunkMap
              total={source.total_chunks}
              current={selectedChunk}
              onSelect={openChunk}
            />
          </Stack>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {lines} lines · {formatBytes(bytes)}
          </Typography>
          {source.embeddings.length > 0 && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {source.embeddings.length}d
            </Typography>
          )}
          {matchedTerms.length > 0 && (
            <Typography variant="caption" sx={{ color: "#8DF4FF" }}>
              matches: {matchedTerms.join(", ")}
            </Typography>
          )}
          {source.tags.length > 0 && (
            <Typography variant="caption" sx={{ color: "#8DF4FF" }}>
              {source.tags.map((tag) => `#${tag}`).join("  ")}
            </Typography>
          )}
          {result.model_scores && Object.keys(result.model_scores).length > 0 && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {Object.keys(result.model_scores).length} models
            </Typography>
          )}
        </Stack>

        <Button
          size="small"
          variant="text"
          onClick={() => setOpen((value) => !value)}
          endIcon={
            <ExpandMoreIcon
              sx={{
                fontSize: 17,
                transform: open ? "rotate(180deg)" : "none",
                transition: "transform 180ms ease",
              }}
            />
          }
          sx={{ color: "text.secondary", px: 0.5, py: 0 }}
        >
          {open ? "Hide" : "Details"}
        </Button>
      </Stack>

      {hasAst && ast && (
        <Box sx={{ mt: 0.35, pt: 0.35, borderTop: "1px solid #12262F" }}>
          <Button
            size="small"
            variant="text"
            startIcon={<AccountTreeIcon sx={{ fontSize: 17 }} />}
            onClick={() => setAstOpen((value) => !value)}
            endIcon={
              <ExpandMoreIcon
                sx={{
                  fontSize: 17,
                  transform: astOpen ? "rotate(180deg)" : "none",
                  transition: "transform 180ms ease",
                }}
              />
            }
            sx={{ color: "text.secondary", px: 0.5, py: 0 }}
          >
            AST tree · {astCounts.symbols} symbols · {astCounts.imports} imports ·{" "}
            {astCounts.exports} exports
          </Button>
          <Collapse in={astOpen} timeout="auto" unmountOnExit>
            <Box sx={{ mt: 0.75 }}>
              <AstTree ast={ast} />
            </Box>
          </Collapse>
        </Box>
      )}

      <Collapse in={open} timeout="auto" unmountOnExit>
        <Box className="result-details">
          <Typography variant="caption" className="details-section-title">
            File & chunk
          </Typography>
          <Box className="result-meta-grid">
            <MetaRow label="Title" value={source.title} />
            <MetaRow label="Type / language" value={`${source.type}${language ? ` / ${language}` : ""}`} />
            <MetaRow label="Matched chunk" value={`${source.chunk_index + 1} / ${source.total_chunks}`} />
            <MetaRow label="Chunk size" value={`${chars.toLocaleString()} chars · ${formatBytes(bytes)}`} />
            <MetaRow label="Chunk lines" value={lines} />
            <MetaRow label="Score" value={`${result.score.toFixed(4)} (${result.match_type})`} />
            <MetaRow label="File BLAKE3" value={source.file_blake3} />
            <MetaRow label="Semantic BLAKE3" value={source.semantic_blake3} />
            <MetaRow label="Row ID" value={source.id} />
            <MetaRow label="Chunk ID" value={source.chunk_id} />
            <MetaRow label="Source ID" value={source.source_id} />
            <MetaRow label="Created" value={new Date(source.created_at).toLocaleString()} />
            <MetaRow label="Updated" value={new Date(source.updated_at).toLocaleString()} />
            {source.tags.length > 0 && <MetaRow label="Tags" value={source.tags.join(", ")} />}
            {result.model_scores && Object.keys(result.model_scores).length > 0 && (
              <MetaRow
                label="Model scores"
                value={Object.entries(result.model_scores)
                  .map(([model, score]) => `${model}: ${score.toFixed(3)}`)
                  .join(" · ")}
              />
            )}
          </Box>

          <Typography variant="caption" className="details-section-title">
            Embedding
          </Typography>
          <Box className="result-meta-grid">
            <MetaRow
              label="Dimensions"
              value={source.embeddings.length > 0 ? `${source.embeddings.length} · norm ${embeddingNorm.toFixed(3)}` : "none"}
            />
            <MetaRow
              label="Vector preview"
              value={
                source.embeddings.length > 0
                  ? `[${embeddingPreview}${source.embeddings.length > 8 ? ", …" : ""}]`
                  : "—"
              }
            />
          </Box>

          <Typography variant="caption" className="details-section-title">
            Metadata
          </Typography>
          <Box className="result-meta-grid">
            {metaEntries.map(([key, value]) => (
              <MetaRow key={key} label={key} value={formatMetaValue(value)} />
            ))}
          </Box>

          <Button
            size="small"
            variant="text"
            startIcon={<DataObjectIcon sx={{ fontSize: 17 }} />}
            onClick={() => setRawOpen((value) => !value)}
            endIcon={
              <ExpandMoreIcon
                sx={{
                  fontSize: 17,
                  transform: rawOpen ? "rotate(180deg)" : "none",
                  transition: "transform 180ms ease",
                }}
              />
            }
            sx={{ color: "text.secondary", mt: 1, px: 0.5 }}
          >
            Raw metadata (JSON)
          </Button>
          <Collapse in={rawOpen} timeout="auto" unmountOnExit>
            <Box component="pre" className="raw-json">
              {JSON.stringify(source.metadata, null, 2)}
            </Box>
          </Collapse>

          <Stack direction="row" spacing={1} sx={{ mt: 1.25, alignItems: "center" }}>
            <Button
              size="small"
              variant="text"
              startIcon={<LayersIcon sx={{ fontSize: 17 }} />}
              onClick={() => void loadChunks(source.chunk_index)}
              disabled={chunksLoading}
              sx={{ color: "text.secondary", px: 0.5 }}
            >
              {chunksLoading ? "Loading…" : `Open chunk navigator (${source.total_chunks})`}
            </Button>
            {chunksLoading && <CircularProgress size={16} />}
            {chunks && (
              <Chip size="small" variant="outlined" label={`${chunks.length} loaded`} />
            )}
          </Stack>

          {chunksError && (
            <Typography variant="caption" color="error" sx={{ mt: 1, display: "block" }}>
              {chunksError}
            </Typography>
          )}

          {chunks && (
            <Box sx={{ mt: 1.25 }}>
              <ChunkViewer
                chunks={chunks}
                activeIndex={selectedChunk}
                onSelect={setSelectedChunk}
              />
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
