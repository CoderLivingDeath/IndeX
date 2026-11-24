import type { ReactNode } from "react";
import { Box } from "@mui/material";
import type { SourceMetadata } from "../types";

type AstData = NonNullable<SourceMetadata["ast"]>;

interface TreeRowProps {
  connector: string;
  kind: string;
  name: string;
  meta?: string;
  level?: number;
  title?: string;
}

function TreeRow({ connector, kind, name, meta, level = 0, title }: TreeRowProps) {
  return (
    <Box className="ast-row" sx={{ pl: level * 2 }} title={title}>
      <span className="ast-connector">{connector}</span>
      <span className="ast-kind">{kind}</span>
      <span className="ast-name">{name}</span>
      {meta && <span className="ast-meta">{meta}</span>}
    </Box>
  );
}

function AstGroup({
  label,
  count,
  last,
  children,
}: {
  label: string;
  count: number;
  last: boolean;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Box className="ast-group-block">
      <Box className="ast-row ast-group">
        <span className="ast-connector">{last ? "└─" : "├─"}</span>
        <span className="ast-group-title">{label}</span>
        <span className="ast-count">{count}</span>
      </Box>
      <Box className="ast-children">{children}</Box>
    </Box>
  );
}

export function AstTree({ ast }: { ast: AstData }) {
  const imports = ast.imports ?? [];
  const exports = ast.exports ?? [];
  const symbols = [...(ast.symbols ?? [])].sort((a, b) => a.line - b.line);

  if (imports.length === 0 && exports.length === 0 && symbols.length === 0) {
    return null;
  }

  const groups = [
    {
      key: "imports",
      label: "imports",
      count: imports.length,
      children: imports.map((imp, index) => (
        <TreeRow
          key={`${imp.source}-${index}`}
          connector={index === imports.length - 1 ? "└─" : "├─"}
          kind="import"
          name={imp.source}
          meta={imp.specifiers.length > 0 ? imp.specifiers.join(", ") : "*"}
          level={1}
        />
      )),
    },
    {
      key: "exports",
      label: "exports",
      count: exports.length,
      children: exports.map((exp, index) => (
        <TreeRow
          key={`${exp.name}-${exp.kind}-${index}`}
          connector={index === exports.length - 1 ? "└─" : "├─"}
          kind={exp.kind}
          name={exp.name}
          level={1}
        />
      )),
    },
    {
      key: "symbols",
      label: "symbols",
      count: symbols.length,
      children: symbols.map((symbol, index) => (
        <TreeRow
          key={`${symbol.kind}-${symbol.name}-${symbol.line}-${index}`}
          connector={index === symbols.length - 1 ? "└─" : "├─"}
          kind={symbol.kind}
          name={symbol.name}
          meta={`:${symbol.line}`}
          level={1}
          title={`${symbol.kind} ${symbol.name} (line ${symbol.line})`}
        />
      )),
    },
  ].filter((group) => group.count > 0);

  return (
    <Box className="ast-tree">
      <Box className="ast-row ast-root">
        <span className="ast-connector">▾</span>
        <span className="ast-kind">module</span>
        <span className="ast-meta">
          {symbols.length} symbols · {imports.length} imports · {exports.length} exports
        </span>
      </Box>

      {groups.map((group, index) => (
        <AstGroup
          key={group.key}
          label={group.label}
          count={group.count}
          last={index === groups.length - 1}
        >
          {group.children}
        </AstGroup>
      ))}
    </Box>
  );
}
