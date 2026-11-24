import type {
  AppConfig,
  ClearResponse,
  IndexResponse,
  IndexStats,
  SearchMode,
  SearchResponse,
  SourceResponse,
  SourceType,
  SystemInfo,
} from "./types";

export interface SearchParams {
  q: string;
  mode: SearchMode;
  offset: number;
  limit: number;
  top_k?: number;
  tags?: string;
  source_types?: SourceType[];
  min_score?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status} ${res.statusText}`;
    throw new Error(message);
  }

  return body as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  stats(): Promise<{ stats: IndexStats }> {
    return request("/api/stats");
  },

  config(): Promise<{ config: AppConfig }> {
    return request("/api/config");
  },

  patchConfig(patch: Partial<AppConfig>): Promise<{ status: string; config: AppConfig }> {
    return request("/api/config", jsonInit("PATCH", patch));
  },

  system(): Promise<SystemInfo> {
    return request("/api/system");
  },

  search(params: SearchParams): Promise<SearchResponse> {
    const query = new URLSearchParams({
      q: params.q,
      mode: params.mode,
      offset: String(params.offset),
      limit: String(params.limit),
      top_k: String(params.top_k ?? 200),
    });

    if (params.tags) query.set("tags", params.tags);
    if (params.min_score && params.min_score > 0) {
      query.set("min_score", String(params.min_score));
    }
    if (params.source_types && params.source_types.length > 0) {
      query.set("source_types", params.source_types.join(","));
    }

    return request(`/api/search?${query.toString()}`);
  },

  index(path: string): Promise<IndexResponse> {
    return request("/api/index", jsonInit("POST", { path }));
  },

  clear(): Promise<ClearResponse> {
    return request("/api/index", { method: "DELETE" });
  },

  source(sourceId: string): Promise<SourceResponse> {
    return request(`/api/source?source_id=${encodeURIComponent(sourceId)}`);
  },
};
