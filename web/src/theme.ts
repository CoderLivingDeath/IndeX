import { alpha, createTheme } from "@mui/material/styles";

export const ACCENT = "#00DBFF";
export const ACCENT_2 = "#00B8D9";
export const ACCENT_3 = "#0093B8";
/** Cyan sweep used by progress / selected states. */
export const ACCENT_GRADIENT = "linear-gradient(90deg, #0093B8 0%, #00DBFF 100%)";
export const BRAND_GRADIENT =
  "linear-gradient(135deg, #E9FEFF 0%, #8DF4FF 45%, #00DBFF 100%)";

const background = "#070B0E";
const paper = "#0B1218";

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: ACCENT,
      light: "#8DF4FF",
      dark: ACCENT_3,
      contrastText: "#001014",
    },
    secondary: {
      main: ACCENT_2,
      contrastText: "#001014",
    },
    background: {
      default: background,
      paper,
    },
    text: {
      primary: "#F5FDFF",
      secondary: "#8FA3AD",
    },
    divider: "rgba(0, 219, 255, 0.12)",
    success: { main: "#2ee6a8" },
    warning: { main: "#ffb020" },
    error: { main: "#ff5c7a" },
    info: { main: ACCENT_2 },
  },
  shape: {
    borderRadius: 9,
  },
  typography: {
    fontFamily:
      '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    h1: {
      fontSize: "clamp(1.9rem, 3vw, 2.75rem)",
      fontWeight: 800,
      letterSpacing: "-0.04em",
    },
    h2: {
      fontSize: "1.35rem",
      fontWeight: 700,
      letterSpacing: "-0.02em",
    },
    h3: {
      fontSize: "0.78rem",
      fontWeight: 700,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "#F5FDFF",
    },
    button: {
      textTransform: "none",
      fontWeight: 700,
      letterSpacing: "0.01em",
    },
    overline: {
      letterSpacing: "0.18em",
      fontWeight: 700,
    },
    caption: {
      color: "#8FA3AD",
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: background,
          backgroundImage:
            "radial-gradient(1100px 560px at 8% -10%, rgba(0,219,255,0.10), transparent 62%), radial-gradient(900px 520px at 92% 0%, rgba(0,147,184,0.16), transparent 62%)",
          backgroundAttachment: "fixed",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage:
            "linear-gradient(180deg, rgba(12, 21, 27, 0.95) 0%, rgba(8, 14, 19, 0.98) 100%)",
          border: "1px solid rgba(0, 219, 255, 0.10)",
          boxShadow:
            "0 30px 80px rgba(0, 0, 0, 0.62), 0 6px 18px rgba(0, 0, 0, 0.5)",
          backdropFilter: "blur(16px)",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage:
            "linear-gradient(180deg, rgba(12, 21, 27, 0.94) 0%, rgba(8, 14, 19, 0.98) 100%)",
          border: "1px solid rgba(0, 219, 255, 0.10)",
          boxShadow:
            "0 18px 44px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.42)",
          overflow: "hidden",
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(7, 11, 14, 0.74)",
          backgroundImage: "none",
          backdropFilter: "blur(18px)",
          borderBottom: "1px solid rgba(0, 219, 255, 0.08)",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.55)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          paddingInline: 18,
          minHeight: 40,
          "&.MuiButton-containedPrimary": {
            backgroundImage: "none",
            backgroundColor: ACCENT,
            color: "#001014",
            boxShadow:
              "0 10px 28px rgba(0, 219, 255, 0.38), 0 3px 10px rgba(0, 0, 0, 0.45)",
            "&:hover": {
              backgroundColor: "#5FE9FF",
              backgroundImage: "none",
              boxShadow:
                "0 14px 34px rgba(0, 219, 255, 0.5), 0 4px 14px rgba(0, 0, 0, 0.48)",
            },
          },
          "&.MuiButton-outlinedPrimary": {
            borderColor: alpha(ACCENT, 0.55),
            "&:hover": {
              borderColor: ACCENT,
              backgroundColor: alpha(ACCENT, 0.08),
            },
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          "&:hover": { backgroundColor: alpha(ACCENT, 0.1) },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: "small",
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: "rgba(3, 9, 15, 0.72)",
          "& fieldset": {
            borderColor: "rgba(0, 219, 255, 0.18)",
          },
          "&:hover fieldset": {
            borderColor: "rgba(0, 219, 255, 0.42)",
          },
          "&.Mui-focused fieldset": {
            borderColor: ACCENT,
            boxShadow: "0 0 0 3px rgba(0, 219, 255, 0.14)",
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 5,
          fontWeight: 600,
          borderColor: "rgba(0, 219, 255, 0.22)",
        },
        filled: {
          backgroundColor: "rgba(0, 219, 255, 0.12)",
          color: "#B8F7FF",
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 99,
          backgroundColor: "rgba(0, 219, 255, 0.12)",
          overflow: "hidden",
        },
        bar: {
          backgroundImage: ACCENT_GRADIENT,
        },
      },
    },
    MuiPaginationItem: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          borderColor: "rgba(0, 219, 255, 0.2)",
        },
        page: {
          "&.Mui-selected": {
            backgroundImage: ACCENT_GRADIENT,
            color: "#001014",
            fontWeight: 800,
            "&:hover": { backgroundImage: ACCENT_GRADIENT },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage:
            "linear-gradient(180deg, rgba(12, 21, 27, 0.99), rgba(7, 11, 14, 0.99))",
          border: "1px solid rgba(0, 219, 255, 0.10)",
          boxShadow:
            "0 32px 90px rgba(0, 0, 0, 0.7), 0 8px 24px rgba(0, 0, 0, 0.55)",
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: "#0B1218",
          border: "1px solid rgba(0, 219, 255, 0.2)",
          fontSize: "0.72rem",
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 6 },
      },
    },
  },
});
