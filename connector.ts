import { ChiliBody, type Connector, type Media } from "@chili-publish/studio-connectors";

interface CustomChiliBody extends ChiliBody {
  arrayBuffer: ArrayBuffer;
}

export type ArrayBuffer = {
  id: string;
  bytes: number;
};

// ---------------------------------------------------------------------------
// Constants — no classes, no timers, no Promise.race
// Pure async/await with a simple retry counter loop.
// This is the safest possible form for the GraFx connector sandbox.
// ---------------------------------------------------------------------------

const MAX_RETRIES = 8; // number of attempts before giving up
const RETRY_DELAY_MS = 1500; // flat delay between attempts (ms)

// HTTP statuses that are worth retrying
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 524]);

// ---------------------------------------------------------------------------
// Utility: delay — defined as a standalone function using the connector
// runtime's fetch as a side-channel timer if setTimeout is unavailable,
// but we keep it as a simple fallback-safe no-op if neither is available.
// ---------------------------------------------------------------------------
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // Use setTimeout if available in the sandbox; otherwise resolve immediately
    // so the retry still happens without blocking forever.
    if (typeof setTimeout === "function") {
      setTimeout(resolve, ms);
    } else {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Main connector — no class-level fields other than runtime
// ---------------------------------------------------------------------------
export default class MyConnector implements Media.MediaConnector {
  private runtime: Connector.ConnectorRuntimeContext;

  constructor(runtime: Connector.ConnectorRuntimeContext) {
    this.runtime = runtime;
  }

  // ── Logging ────────────────────────────────────────────────────────────
  private log(...parts: string[]): void {
    if (!this.runtime.options["logEnabled"]) return;
    this.runtime.logError("[AshleyConnector] " + parts.join(" "));
  }

  // ── URL builder ────────────────────────────────────────────────────────
  private buildUrl(imageId: string, imageType: string): string {
    const id = imageId.trim().replace(/\s+/g, "");

    if (imageType === "highres1") {
      return ("https://ashleyfurniture.scene7.com/is/image/AshleyFurniture/"+id+"?wid=1276&hei=1020&fit=fit,1&fmt=jpeg");
    }
    if (imageType === "enterprise2") {
      return ("https://res.cloudinary.com/ashleyhub/image/upload/co_rgb:ffffff,e_colorize:100/v1657307093/MattressLogos/"+id+".png");
    }
    return (
      "https://ashleyfurniture.scene7.com/is/image/AshleyFurniture/"+id+"?wid=240&hei=168&fit=fit,1&fmt=jpeg");
  }

  // ── Fallback image — never throws ──────────────────────────────────────
  private async loadFallback(label: string): Promise<Connector.ArrayBufferPointer | null> {
    try {
      this.log("[" + label + "] Loading fallback image");
      const res = await this.runtime.fetch(
        "https://res.cloudinary.com/diryu8lwp/image/upload/v1777483483/Color-white_hc2z9r.jpg",
        { method: "GET" }
      );
      if (res && res.arrayBuffer) {
        this.log("[" + label + "] Fallback loaded OK");
        return res.arrayBuffer;
      }
      this.log("[" + label + "] Fallback response had no arrayBuffer");
      return null;
    } catch (e) {
      this.log("[" + label + "] Fallback fetch threw: " + String(e));
      return null;
    }
  }

  // ── Core fetch with retry ───────────────────────────────────────────────
  private async fetchImage(
    url: string,
    label: string
  ): Promise<Connector.ArrayBufferPointer | null> {
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      this.log("[" + label + "] Attempt " + attempt + "/" + MAX_RETRIES + " url=" + url);

      try {
        const res = await this.runtime.fetch(url, { method: "GET" });

        // Check ok flag
        if (!res || !res.ok) {
          const status = (res as unknown as { status?: number })?.status ?? 0;
          lastError = "http_" + status;
          this.log("[" + label + "] Attempt " + attempt + " failed: HTTP " + status);

          // Non-retryable 4xx (e.g. 403, 404) — stop immediately
          if (status >= 400 && status < 500 && !RETRYABLE_STATUSES.has(status)) {
            this.log("[" + label + "] Non-retryable status " + status + " — abort");
            return null;
          }

          // Retryable — wait and loop
          if (attempt < MAX_RETRIES) {
            await delay(RETRY_DELAY_MS);
          }
          continue;
        }

        // Check arrayBuffer is present
        if (!res.arrayBuffer) {
          lastError = "no_arraybuffer";
          this.log("[" + label + "] Attempt " + attempt + " — response missing arrayBuffer");
          if (attempt < MAX_RETRIES) {
            await delay(RETRY_DELAY_MS);
          }
          continue;
        }

        // Success
        this.log("[" + label + "] Attempt " + attempt + " SUCCESS");
        return res.arrayBuffer;

      } catch (e) {
        lastError = String(e);
        this.log("[" + label + "] Attempt " + attempt + " threw: " + lastError);
        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS);
        }
      }
    }

    this.log("[" + label + "] All " + MAX_RETRIES + " attempts failed. Last error: " + lastError);
    return null;
  }

  // ── Media connector interface ───────────────────────────────────────────

  async query(
    options: Connector.QueryOptions,
    context: Connector.Dictionary
  ): Promise<Media.MediaPage> {
    const imageId = (context["imageId"] as string) || "";
    this.log("QUERY imageId=" + imageId);

    if (!imageId.trim()) {
      return { pageSize: 0, data: [], links: { nextPage: "" } };
    }

    return {
      pageSize: options.pageSize ?? 1,
      data: [{ id: imageId, name: imageId, relativePath: "", type: 0, metaData: {} }],
      links: { nextPage: "" },
    };
  }

  async detail(id: string, _context: Connector.Dictionary): Promise<Media.MediaDetail> {
    return { name: id, id, metaData: {}, relativePath: "/", type: 0 };
  }

  async download(
    id: string,
    previewType: Media.DownloadType,
    intent: Media.DownloadIntent,
    context: Connector.Dictionary
  ): Promise<Connector.ArrayBufferPointer> {
    const imageId = ((id || (context["imageId"] as string)) ?? "").trim();
    const imageType = ((context["imageType"] as string) ?? "").trim();
    const label = (imageId || "NO_ID") + "/" + (imageType || "default");

    this.log("DOWNLOAD label=" + label + " previewType=" + previewType + " intent=" + intent);

    // Empty imageId — go straight to fallback
    if (!imageId) {
      this.log("[" + label + "] imageId empty — using fallback");
      const fb = await this.loadFallback(label);
      if (fb) return fb;
      // If even fallback fails, return a minimal stub rather than throwing,
      // because throwing = "issue within the download call" in GraFx.
      throw new Error("imageId empty and fallback unavailable for " + label);
    }

    const url = this.buildUrl(imageId, imageType);
    this.log("[" + label + "] Built URL: " + url);

    // Try fetching the real image with retries
    const ptr = await this.fetchImage(url, label);
    if (ptr) return ptr;

    // Exhausted retries — try fallback
    this.log("[" + label + "] Retries exhausted — trying fallback");
    const fb = await this.loadFallback(label);
    if (fb) return fb;

    // Both failed — throw with clear message (GraFx will log this)
    throw new Error("Image and fallback both unavailable for " + label);
  }

  getConfigurationOptions(): Connector.ConnectorConfigValue[] | null {
    return [
      { name: "imageId", displayName: "Image Id", type: "text" },
      { name: "imageType", displayName: "Image Type", type: "text" },
    ];
  }

  getCapabilities(): Media.MediaConnectorCapabilities {
    return { query: true, detail: true, filtering: true, metadata: false };
  }
}