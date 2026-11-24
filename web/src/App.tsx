import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  LinearProgress,
  Pagination,
  Snackbar,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SettingsIcon from "@mui/icons-material/Settings";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";
import type {
  AppConfig,
  IndexStats,
  SearchMode,
  SearchResult,
  SourceType,
  SystemInfo,
} from "./types";
import { api } from "./api";
import { SearchPanel, ALL_SOURCE_TYPES } from "./components/SearchPanel";
import { ResultCard } from "./components/ResultCard";
import { Sidebar } from "./components/Sidebar";
import { ConfigDialog } from "./components/ConfigDialog";
import { BrandMark } from "./components/BrandMark";

type Severity = "success" | "info" | "warning" | "error";

interface Snack {
  message: string;
  severity: Severity;
}

function formatShortDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 700, color: "#EAFBFF" }}>
        {value}
      </Typography>
    </Stack>
  );
}

export default function App() {
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sourceTypes, setSourceTypes] = useState<SourceType[]>([
    ...ALL_SOURCE_TYPES,
  ]);
  const [tags, setTags] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [offset, setOffset] = useState(0);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  const [indexPath, setIndexPath] = useState(".");
  const [indexing, setIndexing] = useState(false);

  const [configOpen, setConfigOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [snack, setSnack] = useState<Snack | null>(null);

  const configInitialised = useRef(false);

  const notify = useCallback((message: string, severity: Severity = "info") => {
    setSnack({ message, severity });
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await api.stats();
      setStats(data.stats);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }, [notify]);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.config();
      setConfig(data.config);
      if (!configInitialised.current && data.config.search?.default_mode) {
        configInitialised.current = true;
        setMode(data.config.search.default_mode);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }, [notify]);

  const loadSystem = useCallback(async () => {
    try {
      setSystem(await api.system());
    } catch {
      setSystem({ cwd: "—", storage: "LanceDB", server: window.location.origin });
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadStats(), loadConfig(), loadSystem()]);
  }, [loadStats, loadConfig, loadSystem]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const search = useCallback(
    async (nextOffset = 0) => {
      if (!query.trim()) {
        notify("Enter a search query", "warning");
        return;
      }

      setSearching(true);
      try {
        const data = await api.search({
          q: query,
          mode,
          offset: nextOffset,
          limit: pageSize,
          top_k: 200,
          tags,
          source_types: sourceTypes,
          min_score: minScore,
        });

        if (data.error) {
          notify(data.error, "error");
          setResults([]);
          setTotal(0);
        } else if (data.info) {
          notify(data.info, "warning");
          setResults([]);
          setTotal(0);
        } else {
          setResults(data.results);
          setTotal(data.total);
          setOffset(nextOffset);
          setHasSearched(true);
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setSearching(false);
      }
    },
    [query, mode, pageSize, tags, sourceTypes, minScore, notify],
  );

  const resetFilters = () => {
    setSourceTypes([...ALL_SOURCE_TYPES]);
    setTags("");
    setMinScore(0);
    setPageSize(20);
  };

  const runIndex = async () => {
    setIndexing(true);
    try {
      const data = await api.index(indexPath.trim() || ".");
      if (data.error) {
        notify(data.error, "error");
      } else {
        notify(data.message ?? "Index complete", "success");
        await loadStats();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIndexing(false);
    }
  };

  const clearIndex = async () => {
    setClearOpen(false);
    try {
      const data = await api.clear();
      if (data.error) {
        notify(data.error, "error");
        return;
      }
      setResults([]);
      setTotal(0);
      setHasSearched(false);
      await loadStats();
      notify(data.message ?? "Index cleared", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const saveConfig = async (patch: Partial<AppConfig>) => {
    const data = await api.patchConfig(patch);
    setConfig(data.config);
    setConfigOpen(false);
    notify("Configuration saved", "success");
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  return (
    <Box className="app-shell">
      <AppBar position="sticky" elevation={0} className="app-bar">
        <Toolbar sx={{ gap: 1.5, minHeight: { xs: 62, md: 70 } }}>
          <BrandMark size={40} />
          <Box sx={{ minWidth: 0 }}>
            <Typography className="wordmark" sx={{ lineHeight: 1 }}>
              Inde<span className="x">X</span>
            </Typography>
            <Typography
              className="wordmark-sub"
              sx={{ display: { xs: "none", sm: "block" } }}
            >
              local code & knowledge index
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          <Stack
            direction="row"
            spacing={0.75}
            sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center" }}
          >
            <Box className="pulse-dot" />
            <Typography variant="caption" sx={{ color: "#8DF4FF" }}>
              online
            </Typography>
          </Stack>

          <Tooltip title="Refresh">
            <IconButton onClick={() => void refreshAll()} aria-label="Refresh">
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Index & settings">
            <IconButton
              onClick={() => setDrawerOpen(true)}
              aria-label="Index and settings"
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box className="content-shell">
        <SearchPanel
          query={query}
          onQueryChange={setQuery}
          mode={mode}
          onModeChange={setMode}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((value) => !value)}
          sourceTypes={sourceTypes}
          onSourceTypesChange={setSourceTypes}
          tags={tags}
          onTagsChange={setTags}
          minScore={minScore}
          onMinScoreChange={setMinScore}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setOffset(0);
          }}
          onSearch={() => void search(0)}
          onResetFilters={resetFilters}
          searching={searching}
        />

        <Stack
          direction="row"
          spacing={{ xs: 1.5, sm: 2.5 }}
          sx={{
            mt: 1,
            mb: 1.5,
            px: 0.5,
            flexWrap: "wrap",
            color: "text.secondary",
          }}
        >
          <StatItem label="files" value={stats?.total_files ?? 0} />
          <StatItem label="chunks" value={stats?.total_chunks ?? 0} />
          <StatItem label="sources" value={stats?.total_sources ?? 0} />
          <StatItem label="updated" value={formatShortDate(stats?.last_indexed)} />
        </Stack>

        {searching && <LinearProgress sx={{ mb: 1.5 }} />}

        {hasSearched && (
          <Stack
            direction="row"
            sx={{ px: 0.5, mt: 2, mb: 1, alignItems: "center", justifyContent: "space-between" }}
          >
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", letterSpacing: "0.12em", textTransform: "uppercase" }}
            >
              {total} results
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {mode} · {pageSize}/page
            </Typography>
          </Stack>
        )}

        {results.map((result, index) => (
          <ResultCard
            key={`${result.source.id}-${result.source.chunk_id}-${index}`}
            result={result}
            query={query}
          />
        ))}

        {!searching && results.length === 0 && (
          <Box className="empty-state">
            <TravelExploreIcon sx={{ fontSize: 38, color: "#38d9c4", mb: 1 }} />
            <Typography variant="h2" sx={{ mb: 0.5, fontSize: "1.1rem" }}>
              {hasSearched ? "No results found" : "Start with a query"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: "auto" }}>
              {hasSearched
                ? "Try a broader query, enable more source types, or lower the minimum score."
                : "Search code and notes semantically, or open settings to index a directory."}
            </Typography>
          </Box>
        )}

        {total > pageSize && (
          <Stack sx={{ py: 2, alignItems: "center" }}>
            <Pagination
              color="primary"
              shape="rounded"
              page={currentPage}
              count={pageCount}
              onChange={(_, page) => void search((page - 1) * pageSize)}
            />
          </Stack>
        )}
      </Box>

      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: { xs: "100%", sm: 380 },
              background: "rgba(5, 10, 17, 0.88)",
              backdropFilter: "blur(22px)",
              borderLeft: "1px solid rgba(0, 219, 255, 0.08)",
              boxShadow: "-20px 0 60px rgba(0,0,0,0.45)",
            },
          },
        }}
      >
        <Box sx={{ p: 2.5 }}>
          <Sidebar
            config={config}
            system={system}
            indexPath={indexPath}
            onIndexPathChange={setIndexPath}
            onIndex={() => void runIndex()}
            indexing={indexing}
            onOpenConfig={() => setConfigOpen(true)}
            onClear={() => setClearOpen(true)}
          />
        </Box>
      </Drawer>

      <ConfigDialog
        open={configOpen}
        config={config}
        onClose={() => setConfigOpen(false)}
        onSave={saveConfig}
      />

      <Dialog open={clearOpen} onClose={() => setClearOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Clear the entire index?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This deletes all indexed chunks and file metadata from LanceDB. The
            configuration file is kept. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setClearOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => void clearIndex()}>
            Clear index
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={5200}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          variant="filled"
          severity={snack?.severity ?? "info"}
          onClose={() => setSnack(null)}
          sx={{ minWidth: 320 }}
        >
          {snack?.message ?? ""}
        </Alert>
      </Snackbar>
    </Box>
  );
}
