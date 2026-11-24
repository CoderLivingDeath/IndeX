import {
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputAdornment,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import type { SearchMode, SourceType } from "../types";

export const ALL_SOURCE_TYPES: SourceType[] = [
  "code",
  "markdown",
  "obsidian",
  "generic",
];

const PAGE_SIZES = [5, 10, 20, 50];

interface SearchPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  sourceTypes: SourceType[];
  onSourceTypesChange: (types: SourceType[]) => void;
  tags: string;
  onTagsChange: (tags: string) => void;
  minScore: number;
  onMinScoreChange: (score: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onSearch: () => void;
  onResetFilters: () => void;
  searching: boolean;
}

export function SearchPanel({
  query,
  onQueryChange,
  mode,
  onModeChange,
  filtersOpen,
  onToggleFilters,
  sourceTypes,
  onSourceTypesChange,
  tags,
  onTagsChange,
  minScore,
  onMinScoreChange,
  pageSize,
  onPageSizeChange,
  onSearch,
  onResetFilters,
  searching,
}: SearchPanelProps) {
  const activeFilters =
    (sourceTypes.length < ALL_SOURCE_TYPES.length ? 1 : 0) +
    (tags.trim() ? 1 : 0) +
    (minScore > 0 ? 1 : 0);

  const toggleSourceType = (type: SourceType, checked: boolean) => {
    onSourceTypesChange(
      checked
        ? [...sourceTypes, type]
        : sourceTypes.filter((value) => value !== type),
    );
  };

  return (
    <Box>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.25}>
        <TextField
          fullWidth
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSearch();
          }}
          placeholder="Search your codebase…"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: "#00DBFF", fontSize: 20 }} />
                </InputAdornment>
              ),
            },
            htmlInput: { "aria-label": "Search query" },
          }}
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              minHeight: 52,
              backgroundColor: "rgba(4, 10, 18, 0.55)",
              boxShadow: "0 8px 22px rgba(0, 0, 0, 0.38)",
            },
          }}
        />

        <FormControl variant="standard" sx={{ minWidth: 122, alignSelf: "center" }}>
          <Select
            id="search-mode"
            value={mode}
            onChange={(event) => onModeChange(event.target.value as SearchMode)}
            disableUnderline
            aria-label="Search mode"
            sx={{
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "#B8F7FF",
              px: 1.25,
              py: 0.5,
              borderRadius: 1.5,
              backgroundColor: "#0B1218",
              border: "1px solid rgba(0, 219, 255, 0.24)",
              boxShadow: "0 5px 14px rgba(0, 0, 0, 0.3)",
            }}
          >
            <MenuItem value="keyword">Keyword</MenuItem>
            <MenuItem value="hybrid">Hybrid</MenuItem>
            <MenuItem value="semantic">Semantic</MenuItem>
          </Select>
        </FormControl>

        <Button
          variant="contained"
          onClick={onSearch}
          disabled={searching}
          startIcon={<SearchIcon sx={{ fontSize: 19 }} />}
          sx={{ minWidth: 124, minHeight: 52, alignSelf: "center" }}
        >
          {searching ? "…" : "Search"}
        </Button>
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 0.75, alignItems: "center", justifyContent: "space-between" }}
      >
        <Badge color="primary" badgeContent={activeFilters || undefined}>
          <Button
            size="small"
            variant="text"
            startIcon={<TuneIcon sx={{ fontSize: 17 }} />}
            onClick={onToggleFilters}
            sx={{ color: "text.secondary", px: 1 }}
          >
            Filters
          </Button>
        </Badge>

        {activeFilters > 0 && (
          <Button
            size="small"
            variant="text"
            startIcon={<RestartAltIcon sx={{ fontSize: 17 }} />}
            onClick={onResetFilters}
            sx={{ color: "text.secondary" }}
          >
            Reset
          </Button>
        )}
      </Stack>

      <Collapse in={filtersOpen} timeout="auto" unmountOnExit>
        <Stack spacing={2.25} sx={{ pt: 2, pb: 1 }}>
          <Box>
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", letterSpacing: "0.12em", textTransform: "uppercase" }}
            >
              Sources
            </Typography>
            <FormGroup row>
              {ALL_SOURCE_TYPES.map((type) => (
                <FormControlLabel
                  key={type}
                  control={
                    <Checkbox
                      size="small"
                      checked={sourceTypes.includes(type)}
                      onChange={(event) => toggleSourceType(type, event.target.checked)}
                    />
                  }
                  label={<Typography variant="caption">{type}</Typography>}
                />
              ))}
            </FormGroup>
          </Box>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2.5}>
            <TextField
              label="Tags"
              placeholder="devops, crypto"
              value={tags}
              onChange={(event) => onTagsChange(event.target.value)}
              helperText="Comma-separated"
              sx={{ minWidth: 200 }}
            />

            <Box sx={{ minWidth: 220, px: 1 }}>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", letterSpacing: "0.12em", textTransform: "uppercase" }}
              >
                Min score · {minScore.toFixed(2)}
              </Typography>
              <Slider
                value={minScore}
                min={0}
                max={1}
                step={0.05}
                onChange={(_, value) => onMinScoreChange(value as number)}
                size="small"
                slotProps={{ input: { "aria-label": "Minimum score" } }}
              />
            </Box>

            <FormControl variant="standard" sx={{ minWidth: 130, alignSelf: "center" }}>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", letterSpacing: "0.12em", textTransform: "uppercase" }}
              >
                Per page
              </Typography>
              <Select
                id="page-size"
                value={pageSize}
                onChange={(event) => onPageSizeChange(Number(event.target.value))}
                disableUnderline
                aria-label="Results per page"
                sx={{ fontSize: "0.85rem", color: "#B8F7FF" }}
              >
                {PAGE_SIZES.map((size) => (
                  <MenuItem key={size} value={size}>
                    {size}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Stack>
      </Collapse>
    </Box>
  );
}
