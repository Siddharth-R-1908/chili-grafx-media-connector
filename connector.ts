import { ChiliBody, type Connector, type Media } from "@chili-publish/studio-connectors";

interface CustomChiliBody extends ChiliBody {
  arrayBuffer: ArrayBuffer;
}

export type ArrayBuffer = {
  id: string;
  bytes: number;
};

// ---------------------------------------------------------------------------
// Per-image retry configuration
// Each image retries independently — no shared/global state between requests.
// ---------------------------------------------------------------------------
const MAX_RETRIES = 8;        // attempts per image before giving up
const RETRY_DELAY_MS = 5000;  // 5s pause between retries for THAT image only

// HTTP statuses worth retrying (transient failures)
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 524]);

// ---------------------------------------------------------------------------
// Delay — per-image only, never blocks other images
// Degrades to no-op if setTimeout is unavailable in the GraFx sandbox.
// ---------------------------------------------------------------------------
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setTimeout === "function") {
      setTimeout(resolve, ms);
    } else {
      resolve(); // sandbox has no setTimeout — retry immediately
    }
  });
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------
export default class MyConnector implements Media.MediaConnector {
  private runtime: Connector.ConnectorRuntimeContext;

  constructor(runtime: Connector.ConnectorRuntimeContext) {
    this.runtime = runtime;
  }

  // ── Logging ──────────────────────────────────────────────────────────────
  private log(...parts: string[]): void {
    if (!this.runtime.options["logEnabled"]) return;
    this.runtime.logError("[AshleyConnector] " + parts.join(" "));
  }

  // ── URL builder ──────────────────────────────────────────────────────────
  private buildUrl(imageId: string, imageType: string): string {
    const id = imageId.trim().replace(/\s+/g, "");

    if (imageType === "highres1") {
      return ("https://ashleyfurniture.scene7.com/is/image/AshleyFurniture/"+id +"?wid=1276&hei=1020&fit=fit,1&fmt=jpeg");}
    else if (imageType === "enterprise2") {
      return ("https://res.cloudinary.com/ashleyhub/image/upload/co_rgb:ffffff,e_colorize:100/v1657307093/MattressLogos/"+id+".png");
    }
    else {
      return ("https://ashleyfurniture.scene7.com/is/image/AshleyFurniture/"+id+"?wid=240&hei=168&fit=fit,1&fmt=jpeg");
    }
  }

  // ── Fallback image — never throws ────────────────────────────────────────
  private async loadFallback(label: string): Promise<Connector.ArrayBufferPointer | null> {
    try {
      this.log("[" + label + "] [FALLBACK] Attempting fallback image load");
      const res = await this.runtime.fetch(
        "https://res.cloudinary.com/diryu8lwp/image/upload/v1777483483/Color-white_hc2z9r.jpg",
        { method: "GET" }
      );
      if (res && res.arrayBuffer) {
        this.log("[" + label + "] [FALLBACK] Loaded successfully");
        return res.arrayBuffer;
      }
      this.log("[" + label + "] [FALLBACK] Response had no arrayBuffer");
      return null;
    } catch (e) {
      this.log("[" + label + "] [FALLBACK] Fetch threw: " + String(e));
      return null;
    }
  }

  // ── Per-image fetch with independent retry loop ───────────────────────────
  //
  // This method is called once per image. Its delay() calls only block THIS
  // image's async chain — all other images running in parallel are completely
  // unaffected and continue at full speed.
  // ---------------------------------------------------------------------------
  private async fetchImage(
    url: string,
    label: string
  ): Promise<Connector.ArrayBufferPointer | null> {
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      this.log("[" + label + "] [Attempt " + attempt + "/" + MAX_RETRIES + "] Fetching: " + url);

      try {
        const res = await this.runtime.fetch(url, { method: "GET" });

        // ── HTTP status check ─────────────────────────────────────────────
        if (!res || !res.ok) {
          const status = (res as unknown as { status?: number })?.status ?? 0;
          lastError = "http_" + status;

          // Permanent failure — fast-fail, no retry
          if (status >= 400 && status < 500 && !RETRYABLE_STATUSES.has(status)) {
            this.log("[" + label + "] [Attempt " + attempt + "] Non-retryable HTTP "+status+" — fast-failing to fallback");
            return null;
          }

          // Transient failure — pause THIS image only, then retry
          this.log("[" + label + "] [Attempt " + attempt + "] Transient HTTP " + status +" — pausing " + RETRY_DELAY_MS + "ms before retry (other images unaffected)");
          if (attempt < MAX_RETRIES) {
            await delay(RETRY_DELAY_MS);
          }
          continue;
        }

        // ── arrayBuffer presence check ────────────────────────────────────
        if (!res.arrayBuffer) {
          lastError = "no_arraybuffer";
          this.log("[" + label + "] [Attempt " + attempt + "] Response missing arrayBuffer" +" — pausing " + RETRY_DELAY_MS + "ms before retry");
          if (attempt < MAX_RETRIES) {
            await delay(RETRY_DELAY_MS);
          }
          continue;
        }

        // ── Success ───────────────────────────────────────────────────────
        this.log("[" +label+"] [Attempt " + attempt + "] SUCCESS" +(attempt > 1 ? " (recovered after " +(attempt - 1)+" failure(s))" : ""));
        return res.arrayBuffer;

      } catch (e) {
        lastError = String(e);
        this.log("[" + label + "] [Attempt " + attempt + "] Threw: " + lastError +" — pausing " + RETRY_DELAY_MS + "ms before retry");
        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS);
        }
      }
    }

    // All attempts exhausted for this image
    this.log("[" + label + "] [FAILED] All " + MAX_RETRIES + " attempts exhausted." +" Last error: " + lastError + " — proceeding to fallback");
    return null;
  }

  // ── Media connector interface ─────────────────────────────────────────────

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

    this.log(
      "DOWNLOAD label=" + label +
      " previewType=" + previewType +
      " intent=" + intent
    );

    // Empty imageId — go straight to fallback
    if (!imageId) {
      this.log("[" + label + "] imageId empty — using fallback");
      const fb = await this.loadFallback(label);
      if (fb) return fb;
      throw new Error("imageId empty and fallback unavailable for " + label);
    }

    const url = this.buildUrl(imageId, imageType);
    this.log("[" + label + "] Built URL: " + url);

    // Fetch with per-image independent retry loop
    const ptr = await this.fetchImage(url, label);
    if (ptr) return ptr;

    // Retries exhausted — try fallback
    const fb = await this.loadFallback(label);
    if (fb) return fb;

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