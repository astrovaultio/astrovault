import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient, Frame, ProcessedAsset } from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

const framePreviewUrlCache = new Map<number, string>();
const framePreviewCacheOrder: number[] = [];
const maxFramePreviewCache = 400;
const processedAssetPreviewUrlCache = new Map<number, string>();
const processedAssetPreviewCacheOrder: number[] = [];
const maxProcessedAssetPreviewCache = 300;

export const getFramePreviewCache = (key: number) => framePreviewUrlCache.get(key) ?? "";
export const getProcessedAssetPreviewCache = (id: number) => processedAssetPreviewUrlCache.get(id) ?? "";

export const rememberFramePreview = (frameId: number, url: string) => {
  if (!framePreviewUrlCache.has(frameId)) framePreviewCacheOrder.push(frameId);
  framePreviewUrlCache.set(frameId, url);
  while (framePreviewCacheOrder.length > maxFramePreviewCache) {
    const oldest = framePreviewCacheOrder.shift();
    if (oldest == null) break;
    const oldUrl = framePreviewUrlCache.get(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    framePreviewUrlCache.delete(oldest);
  }
};

export const rememberProcessedAssetPreview = (assetId: number, url: string) => {
  if (!processedAssetPreviewUrlCache.has(assetId)) processedAssetPreviewCacheOrder.push(assetId);
  processedAssetPreviewUrlCache.set(assetId, url);
  while (processedAssetPreviewCacheOrder.length > maxProcessedAssetPreviewCache) {
    const oldest = processedAssetPreviewCacheOrder.shift();
    if (oldest == null) break;
    const oldUrl = processedAssetPreviewUrlCache.get(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    processedAssetPreviewUrlCache.delete(oldest);
  }
};

export function useApi(token: string | null, onUnauthorized: () => void): ApiClient {
  return useMemo(
    () => async (path: string, init?: RequestInit) => {
      const res = await fetch(`${apiBase}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
      if (res.status === 401) {
        onUnauthorized();
        throw new Error("Session expired. Please sign in again.");
      }
      if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
      return res;
    },
    [onUnauthorized, token],
  );
}

export function useAutoRefresh(action: () => void, refreshSeconds: number) {
  useEffect(() => {
    if (!refreshSeconds || refreshSeconds <= 0) return;
    const timer = window.setInterval(action, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [action, refreshSeconds]);
}

export const useInViewport = <T extends HTMLElement>() => {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "360px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible] as const;
};

export function useLazyFrameImage(api: ApiClient, frame: Frame, kind: "thumbnail" | "preview", enabled = true) {
  const cacheKey = kind === "thumbnail" ? frame.id * -1 : frame.id;
  const [ref, inViewport] = useInViewport<HTMLDivElement>();
  const [url, setUrl] = useState(() => getFramePreviewCache(cacheKey));
  const [failed, setFailed] = useState(false);
  const endpointKind = kind === "thumbnail" && !frame.thumbnailStorageKey && frame.previewStorageKey ? "preview" : kind;
  const hasImage = kind === "thumbnail" ? !!(frame.thumbnailStorageKey || frame.previewStorageKey) : !!frame.previewStorageKey;
  useEffect(() => {
    if (!enabled || !inViewport || !hasImage || url || failed) return;
    let active = true;
    void api(`/api/frames/${frame.id}/${endpointKind}`)
      .then((res) => res.blob())
      .then((blob) => {
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        rememberFramePreview(cacheKey, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, cacheKey, enabled, endpointKind, failed, frame.id, hasImage, inViewport, url]);
  return { ref, url, hasImage, failed };
}

export function useLazyProcessedAssetImage(api: ApiClient, asset: ProcessedAsset) {
  const [ref, inViewport] = useInViewport<HTMLDivElement>();
  const [url, setUrl] = useState(() => getProcessedAssetPreviewCache(asset.id));
  const [failed, setFailed] = useState(false);
  const hasImage = !!(asset.previewStorageKey || asset.storageKey);
  useEffect(() => {
    if (!inViewport || !hasImage || url || failed) return;
    let active = true;
    void api(`/api/processed-assets/${asset.id}/preview`)
      .then((res) => {
        const contentType = res.headers.get("Content-Type") ?? "";
        if (!contentType.toLowerCase().startsWith("image/")) throw new Error("Not an image");
        return res.blob();
      })
      .then((blob) => {
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        rememberProcessedAssetPreview(asset.id, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, asset.id, hasImage, failed, inViewport, url]);
  return { ref, url, hasImage, failed };
}

export function useProcessedAssetPreviewUrls(
  api: ApiClient,
  assets: ProcessedAsset[],
  limit: number,
  enabled = true,
) {
  const [urls, setUrls] = useState<Record<number, string>>(() =>
    Object.fromEntries(Array.from(processedAssetPreviewUrlCache.entries())),
  );
  const ref = useRef<Record<number, string>>(
    Object.fromEntries(Array.from(processedAssetPreviewUrlCache.entries())),
  );
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const missing = assets
      .filter((a) => a.previewStorageKey && !ref.current[a.id])
      .slice(0, limit);
    if (missing.length === 0) return;
    const load = async () => {
      const queue = [...missing];
      const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (queue.length > 0) {
          const asset = queue.shift();
          if (!asset) return;
          try {
            const res = await api(`/api/processed-assets/${asset.id}/preview`);
            const contentType = res.headers.get("Content-Type") ?? "";
            if (!contentType.toLowerCase().startsWith("image/")) continue;
            const url = URL.createObjectURL(await res.blob());
            ref.current[asset.id] = url;
            rememberProcessedAssetPreview(asset.id, url);
          } catch {}
        }
      });
      await Promise.all(workers);
      if (active) setUrls({ ...ref.current });
    };
    void load();
    return () => {
      active = false;
    };
  }, [api, assets, limit, enabled]);
  return urls;
}
