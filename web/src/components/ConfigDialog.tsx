import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { AppConfig, SearchMode } from "../types";

interface ConfigDialogProps {
  open: boolean;
  config: AppConfig | null;
  onClose: () => void;
  onSave: (patch: Partial<AppConfig>) => Promise<void>;
}

const STRATEGIES = ["heading", "paragraph", "sentence", "code", "overflow"];

export function ConfigDialog({ open, config, onClose, onSave }: ConfigDialogProps) {
  const [model, setModel] = useState("");
  const [strategy, setStrategy] = useState("heading");
  const [maxChunk, setMaxChunk] = useState(500);
  const [overlap, setOverlap] = useState(32);
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [topK, setTopK] = useState(10);
  const [weight, setWeight] = useState(0.7);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !config) return;
    setModel(config.models[0]?.name ?? "");
    setStrategy(config.chunking.default_strategy);
    setMaxChunk(config.chunking.max_chunk_size);
    setOverlap(config.chunking.overlap);
    setMode(config.search.default_mode);
    setTopK(config.search.top_k);
    setWeight(config.search.hybrid_weight);
  }, [open, config]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const models = config.models.map((entry, index) =>
        index === 0 ? { ...entry, name: model } : entry,
      );
      await onSave({
        models,
        universal_model: model,
        chunking: {
          default_strategy: strategy,
          max_chunk_size: Math.max(50, Number(maxChunk) || 500),
          overlap: Math.max(0, Number(overlap) || 0),
        },
        search: {
          default_mode: mode,
          top_k: Math.max(1, Number(topK) || 10),
          hybrid_weight: Math.min(1, Math.max(0, Number(weight) || 0)),
        },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Session configuration
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          Changes are persisted to .indeX/config.json
        </Typography>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            fullWidth
          />

          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="cfg-strategy-label">Chunk strategy</InputLabel>
              <Select
                id="cfg-strategy"
                labelId="cfg-strategy-label"
                label="Chunk strategy"
                value={strategy}
                onChange={(event) => setStrategy(event.target.value)}
              >
                {STRATEGIES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel id="cfg-mode-label">Default mode</InputLabel>
              <Select
                id="cfg-mode"
                labelId="cfg-mode-label"
                label="Default mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as SearchMode)}
              >
                <MenuItem value="keyword">keyword</MenuItem>
                <MenuItem value="hybrid">hybrid</MenuItem>
                <MenuItem value="semantic">semantic</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Max chunk size"
              type="number"
              value={maxChunk}
              onChange={(event) => setMaxChunk(Number(event.target.value))}
            />
            <TextField
              label="Overlap"
              type="number"
              value={overlap}
              onChange={(event) => setOverlap(Number(event.target.value))}
            />
            <TextField
              label="Top-K"
              type="number"
              value={topK}
              onChange={(event) => setTopK(Number(event.target.value))}
            />
            <TextField
              label="Hybrid weight"
              type="number"
              value={weight}
              onChange={(event) => setWeight(Number(event.target.value))}
              slotProps={{
                htmlInput: { min: 0, max: 1, step: 0.05 },
              }}
            />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
