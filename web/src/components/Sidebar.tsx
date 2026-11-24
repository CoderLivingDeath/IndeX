import type { ReactNode } from "react";
import {
  Box,
  Button,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import type { AppConfig, SystemInfo } from "../types";

interface SidebarProps {
  config: AppConfig | null;
  system: SystemInfo | null;
  indexPath: string;
  onIndexPathChange: (value: string) => void;
  onIndex: () => void;
  indexing: boolean;
  onOpenConfig: () => void;
  onClear: () => void;
}

function SessionRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box className="session-row">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </Box>
  );
}

export function Sidebar({
  config,
  system,
  indexPath,
  onIndexPathChange,
  onIndex,
  indexing,
  onOpenConfig,
  onClear,
}: SidebarProps) {
  const model = config?.models[0];

  return (
    <Stack spacing={3.5}>
      <Box>
        <Typography variant="h3" sx={{ mb: 1 }}>
          Index
        </Typography>
        <TextField
          fullWidth
          value={indexPath}
          onChange={(event) => onIndexPathChange(event.target.value)}
          placeholder="Path to index"
          slotProps={{
            input: {
              startAdornment: (
                <Box sx={{ mr: 1, display: "flex", color: "#8DF4FF" }}>
                  <FolderOpenIcon sx={{ fontSize: 18 }} />
                </Box>
              ),
            },
            htmlInput: { "aria-label": "Directory path to index" },
          }}
        />
        <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<BoltIcon sx={{ fontSize: 18 }} />}
            onClick={onIndex}
            disabled={indexing}
          >
            {indexing ? "Indexing…" : "Index"}
          </Button>
          <Tooltip title="Clear the entire index">
            <IconButton
              onClick={onClear}
              aria-label="Clear index"
              sx={{ color: "#8DF4FF", border: "1px solid rgba(0,219,255,0.12)" }}
            >
              <DeleteOutlineIcon sx={{ fontSize: 19 }} />
            </IconButton>
          </Tooltip>
        </Stack>
        {indexing && <LinearProgress sx={{ mt: 1.5 }} />}
      </Box>

      <Box>
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
        >
          <Typography variant="h3">Session</Typography>
          <Button
            size="small"
            variant="text"
            startIcon={<EditIcon sx={{ fontSize: 16 }} />}
            onClick={onOpenConfig}
            disabled={!config}
            sx={{ color: "text.secondary" }}
          >
            Edit
          </Button>
        </Stack>
        <SessionRow label="Model" value={model?.name ?? "—"} />
        <SessionRow label="Dimensions" value={model?.dimensions ?? "—"} />
        <SessionRow label="Provider" value={model?.provider ?? "—"} />
        <SessionRow label="Chunk strategy" value={config?.chunking.default_strategy ?? "—"} />
        <SessionRow label="Max chunk" value={config?.chunking.max_chunk_size ?? "—"} />
        <SessionRow label="Overlap" value={config?.chunking.overlap ?? "—"} />
        <SessionRow label="Default mode" value={config?.search.default_mode ?? "—"} />
        <SessionRow label="Top-K" value={config?.search.top_k ?? "—"} />
        <SessionRow
          label="Hybrid weight"
          value={config ? config.search.hybrid_weight.toFixed(2) : "—"}
        />
      </Box>

      <Box>
        <Typography variant="h3" sx={{ mb: 1 }}>
          System
        </Typography>
        <SessionRow label="Storage" value={system?.storage ?? "LanceDB"} />
        <SessionRow label="CWD" value={system?.cwd ?? "—"} />
        <SessionRow label="Server" value={system?.server ?? window.location.origin} />
      </Box>
    </Stack>
  );
}
