import { useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Room } from "../types";
import type { RegionSemantics } from "../algorithms/semantics/regionSemantics";

export type CommandSuggestion = { label: string; example: string };
export type SemanticState = "off" | "loading" | "ready" | "error";

interface ToolsPanelProps {
  // Panel toggles
  panelExpanded: boolean;
  onPanelExpandedChange: Dispatch<SetStateAction<boolean>>;
  areaSemanticsExpanded: boolean;
  onAreaSemanticsExpandedChange: Dispatch<SetStateAction<boolean>>;
  jsonExpanded: boolean;
  onJsonExpandedChange: Dispatch<SetStateAction<boolean>>;
  aiChatExpanded: boolean;
  onAiChatExpandedChange: Dispatch<SetStateAction<boolean>>;
  commandsExpanded: boolean;
  onCommandsExpandedChange: Dispatch<SetStateAction<boolean>>;

  // Compute Semantics
  visibleRooms: Room[];
  regionSemanticsById: Record<string, RegionSemantics>;
  onComputeSemantics: () => void;

  // Clean Walls
  onCleanWalls: () => void;

  // Test — random Site/Buildable/Footprint cascade (dev shortcut).
  onTestDrawPolygon: () => void;

  /** Capture a PNG snapshot of the currently-visible canvas (3D if in 3D mode, else 2D).
   *  Returns the data URL ("data:image/png;base64,...") or null on failure. */
  onCaptureCanvasPng: () => Promise<string | null>;
  /** Capture six multi-view PNGs of the 3D scene. Returns `[{ view, dataUrl }, …]`
   *  or null on failure. Will auto-switch the editor to 3D mode if it isn't already. */
  onCaptureSnapshots: () => Promise<{ view: string; dataUrl: string }[] | null>;

  // AI Chat
  aiPrompt: string;
  onAiPromptChange: (value: string) => void;
  aiApiKey: string;
  onAiApiKeyChange: (value: string) => void;
  aiModel: string;
  onAiModelChange: (value: string) => void;
  aiBusy: boolean;
  onAiGenerate: () => void;

  // JSON
  jsonText: string;
  onJsonTextChange: (value: string) => void;
  jsonDragOver: boolean;
  onJsonDragOverChange: (value: boolean) => void;
  onApplyJsonPreview: () => void;
  onApplyJsonCommit: () => void;

  // Commands
  commandsInput: string;
  onCommandsInputChange: (value: string) => void;
  commandsFocused: boolean;
  onCommandsFocusedChange: (value: boolean) => void;
  commandSuggestions: CommandSuggestion[];
  commandCatalogue: CommandSuggestion[];
  semanticState: SemanticState;
  onLoadSemanticLayer: () => void;
  onCommandsPreview: () => void;
  onCommandsRun: () => void;
}

export const ToolsPanel = ({
  panelExpanded,
  onPanelExpandedChange,
  areaSemanticsExpanded,
  onAreaSemanticsExpandedChange,
  jsonExpanded,
  onJsonExpandedChange,
  aiChatExpanded,
  onAiChatExpandedChange,
  commandsExpanded,
  onCommandsExpandedChange,
  visibleRooms,
  regionSemanticsById,
  onComputeSemantics,
  onCleanWalls,
  onTestDrawPolygon,
  onCaptureCanvasPng,
  onCaptureSnapshots,
  aiPrompt,
  onAiPromptChange,
  aiApiKey,
  onAiApiKeyChange,
  aiModel,
  onAiModelChange,
  aiBusy,
  onAiGenerate,
  jsonText,
  onJsonTextChange,
  jsonDragOver,
  onJsonDragOverChange,
  onApplyJsonPreview,
  onApplyJsonCommit,
  commandsInput,
  onCommandsInputChange,
  commandsFocused,
  onCommandsFocusedChange,
  commandSuggestions,
  commandCatalogue,
  semanticState,
  onLoadSemanticLayer,
  onCommandsPreview,
  onCommandsRun,
}: ToolsPanelProps) => {
  const [testExpanded, setTestExpanded] = useState<boolean>(false);
  const [sampleJsonsExpanded, setSampleJsonsExpanded] = useState<boolean>(false);

  const SAMPLE_1_SITE_TO_FOOTPRINT = `{
  "rooms": [
    {
      "create": {
        "label": "Test Site Area",
        "roomType": "site-boundary",
        "fill": "rgba(254, 243, 199, 0.4)",
        "stroke": "#b45309",
        "max height": 30,
        "floor_height": 3,
        "max FSI": 2.5,
        "GCR": 40,
        "points": [
          { "x": 0,    "y": -780 },
          { "x": 720,  "y": -260 },
          { "x": 530,  "y": 620  },
          { "x": -440, "y": 700  },
          { "x": -760, "y": -160 }
        ],
        "walls": [
          { "segmentType": "site-boundary", "boundaryTreatment": "fence", "setbackRegime": "road",              "roadWidthM": 12 },
          { "segmentType": "site-boundary", "boundaryTreatment": "fence", "setbackRegime": "adjoining-plot" },
          { "segmentType": "site-boundary", "boundaryTreatment": "fence", "setbackRegime": "green-open-space" },
          { "segmentType": "site-boundary", "boundaryTreatment": "fence", "setbackRegime": "adjoining-plot" },
          { "segmentType": "site-boundary", "boundaryTreatment": "fence", "setbackRegime": "nala-drain" }
        ]
      },
      "operations": [
        {
          "tool": "regime-inset",
          "params": {
            "regimes": {
              "road": [
                { "if": { "widthLt": 6  }, "setback": 1.5 },
                { "if": { "widthLt": 9  }, "setback": 3.0 },
                { "if": { "widthLt": 12 }, "setback": 3.5 },
                { "setback": 6.0 }
              ],
              "adjoining-plot":   { "setback": 1.5 },
              "nala-drain":       { "setback": 3.0 },
              "water-body":       { "setback": 5.0 },
              "restricted-zone":  { "setback": 9.0 },
              "green-open-space": { "setback": 3.0 }
            },
            "default": 0
          },
          "commit": false
        },
        {
          "tool": "optimise-rect",
          "params": {
            "shape": "rectangle",
            "reference": "custom",
            "axisAngle": 0,
            "count": 2,
            "union": true,
            "shrinkEnabled": true,
            "shrinkAngle": 90,
            "optimiseShrinkEnabled": true,
            "targetFromGcr": true
          },
          "commit": false
        },
        {
          "tool": "massing",
          "params": {
            "avgWidth": 3.5,
            "floorsFromSiteProperties": true
          },
          "commit": false
        }
      ]
    }
  ]
}`;

  const SAMPLE_3_FOOTPRINT_TO_FURNITURE = `{
  "create": [
    {
      "id": "floorplate-01",
      "label": "Apartment Boundary",
      "points": [[0,0], [12,0], [12,10], [0,10]],
      "fill": "rgba(100,100,100,0.05)",
      "stroke": "#333"
    }
  ],
  "rooms": [
    {
      "id": "R1-BSP",
      "match": { "id": "floorplate-01" },
      "operations": [
        {
          "tool": "bsp",
          "params": {
            "useAreaPercent": true,
            "tiltAngle": 90,
            "seeds": [
              {"x": 0.4, "y": 0.4, "weight": 28},
              {"x": 0.8, "y": 0.2, "weight": 18},
              {"x": 0.8, "y": 0.8, "weight": 15},
              {"x": 0.1, "y": 0.2, "weight": 12},
              {"x": 0.2, "y": 0.5, "weight": 10},
              {"x": 0.9, "y": 0.5, "weight": 6},
              {"x": 0.1, "y": 0.8, "weight": 6},
              {"x": 0.5, "y": 0.05, "weight": 3},
              {"x": 0.05, "y": 0.5, "weight": 2}
            ]
          },
          "commit": true
        }
      ]
    },
    {
      "id": "R2-Living",
      "match": { "areaM2": { "gt": 25 } },
      "operations": [
        { "tool": "set-label", "params": { "label": "Large Interior" }, "commit": true },
        { "tool": "add-window", "params": { "side": "N", "position": 50, "widthM": 2.5 }, "commit": true },
        { "tool": "place-object", "params": { "objects": [
          {"kind": "sofa", "length": 3.0, "breadth": 1.0, "position": 15, "setback": 0.1},
          {"kind": "tv-unit", "length": 2.0, "breadth": 0.4, "position": 65, "setback": 0.1}
        ]}, "commit": true }
      ]
    },
    {
      "id": "R3-Bedrooms",
      "match": { "areaM2": { "gt": 14, "lte": 25 } },
      "operations": [
        { "tool": "set-label", "params": { "label": "Medium Interior" }, "commit": true },
        { "tool": "add-window", "params": { "side": "E", "position": 50, "widthM": 1.5 }, "commit": true },
        { "tool": "add-door", "params": { "side": "W", "position": 20, "widthM": 0.9 }, "commit": true },
        { "tool": "place-object", "params": { "objects": [
          {"kind": "bed", "length": 2.0, "breadth": 1.8, "position": 70, "setback": 0.05},
          {"kind": "wardrobe", "length": 1.8, "breadth": 0.6, "position": 30, "setback": 0.05}
        ]}, "commit": true }
      ]
    },
    {
      "id": "R4-Kitchen",
      "match": { "areaM2": { "gt": 9, "lte": 14 } },
      "operations": [
        { "tool": "set-label", "params": { "label": "Service" }, "commit": true },
        { "tool": "add-window", "params": { "side": "W", "position": 50, "widthM": 1.2 }, "commit": true },
        { "tool": "place-object", "params": { "objects": [
          {"kind": "fridge", "length": 0.7, "breadth": 0.7, "position": 10, "setback": 0.05},
          {"kind": "table", "length": 1.2, "breadth": 0.7, "position": 80, "setback": 0.05}
        ]}, "commit": true }
      ]
    },
    {
      "id": "R5-Bathrooms",
      "match": { "areaM2": { "gt": 4, "lte": 9 } },
      "operations": [
        { "tool": "set-label", "params": { "label": "Service" }, "commit": true },
        { "tool": "add-door", "params": { "side": "S", "position": 50, "widthM": 0.75 }, "commit": true },
        { "tool": "place-object", "params": { "objects": [
          {"kind": "toilet", "length": 0.5, "breadth": 0.7, "position": 85, "setback": 0.05},
          {"kind": "bathtub", "length": 1.6, "breadth": 0.7, "position": 20, "setback": 0.05}
        ]}, "commit": true }
      ]
    }
  ]
}`;
  // Render — AI image render of the current 3D snapshot. Local state persisted to
  // localStorage so the user's API key + model survive reloads.
  const [renderExpanded, setRenderExpanded] = useState<boolean>(false);
  const [renderApiKey, setRenderApiKey] = useState<string>(() => {
    try { return localStorage.getItem("render-api-key") ?? ""; } catch { return ""; }
  });
  const [renderModel, setRenderModel] = useState<string>(() => {
    try { return localStorage.getItem("render-model-v3") || "gemini-3.1-flash-image-preview"; } catch { return "gemini-3.1-flash-image-preview"; }
  });
  const [renderPrompt, setRenderPrompt] = useState<string>(
    "Edit the attached architectural massing snapshot into a photorealistic render with daylight, realistic facade materials, landscaping, and sky."
  );
  const [renderBusy, setRenderBusy] = useState<boolean>(false);
  const [renderResultUrl, setRenderResultUrl] = useState<string | null>(null);
  // ── Video render (Veo) ──
  // Veo is an async long-running-operation (LRO): we POST a prompt + optional
  // reference image, get an operation name back, poll until done, then fetch
  // the generated video URI and surface a <video> + download link.
  const [videoModel, setVideoModel] = useState<string>(() => {
    try { return localStorage.getItem("video-model-v1") || "veo-3.1-generate-preview"; } catch { return "veo-3.1-generate-preview"; }
  });
  const [videoPrompt, setVideoPrompt] = useState<string>(
    "Cinematic drone fly-through of this architectural massing at golden hour. Smooth slow forward motion, wide cinematic aspect, photorealistic materials, soft warm light, gentle camera arc around the building, depth of field, subtle haze, calm atmosphere."
  );
  const [videoBusy, setVideoBusy] = useState<boolean>(false);
  const [videoStatus, setVideoStatus] = useState<string>(""); // human-readable progress for the user
  const [videoResultUrl, setVideoResultUrl] = useState<string | null>(null);
  /** Six-view snapshots captured from the 3D scene. The user picks one to send to the model. */
  const [renderSnapshots, setRenderSnapshots] = useState<{ view: string; dataUrl: string }[] | null>(null);
  /** Multi-select: user can pick one or more snapshot views to send to the model.
   *  Gemini accepts multiple inline_data parts in a single request, which lets it
   *  reason about a 3D massing from several angles at once. */
  const [renderSelectedViews, setRenderSelectedViews] = useState<string[]>([]);
  const [snapshotBusy, setSnapshotBusy] = useState<boolean>(false);

  const handleSnapshot = async () => {
    try {
      setSnapshotBusy(true);
      const shots = await onCaptureSnapshots();
      if (!shots || shots.length === 0) {
        toast.error("Snapshot failed");
        return;
      }
      setRenderSnapshots(shots);
      // Default-select the first view so Render works one-click after Snapshot,
      // but the user can shift to a multi-image request by toggling more tiles on.
      setRenderSelectedViews(shots[0] ? [shots[0].view] : []);
      toast.success(`Captured ${shots.length} views — pick one or more to render`);
    } finally {
      setSnapshotBusy(false);
    }
  };

  const handleRender = async () => {
    if (!renderApiKey.trim()) {
      toast.error("Add a Google AI Studio API key first");
      return;
    }
    try {
      setRenderBusy(true);
      setRenderResultUrl(null);
      try { localStorage.setItem("render-api-key", renderApiKey); } catch { /* ignore */ }
      try { localStorage.setItem("render-model-v3", renderModel); } catch { /* ignore */ }
      // Collect every user-picked snapshot. If none are selected (or no snapshot has
      // been taken), fall back to live-capturing the on-screen canvas — so the Render
      // button still works without first hitting Snapshot.
      const pickedUrls: string[] = [];
      if (renderSnapshots && renderSelectedViews.length > 0) {
        for (const v of renderSelectedViews) {
          const sel = renderSnapshots.find((s) => s.view === v);
          if (sel?.dataUrl) pickedUrls.push(sel.dataUrl);
        }
      }
      if (pickedUrls.length === 0) {
        const live = await onCaptureCanvasPng();
        if (live) pickedUrls.push(live);
      }
      if (pickedUrls.length === 0) { toast.error("Couldn't capture canvas snapshot"); return; }
      // Build the multi-image Gemini payload: one text part with the prompt followed
      // by one inline_data part per selected snapshot. Mime is inferred from the
      // dataUrl prefix (jpeg for cube faces, png otherwise).
      // Renamed from `parts` to `requestParts` to avoid colliding with the
      // identically-named local later in this function that reads parts off the
      // Gemini response.
      const requestParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
        { text: renderPrompt },
      ];
      for (const url of pickedUrls) {
        const mime = url.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
        const data = url.split(",")[1] ?? "";
        requestParts.push({ inline_data: { mime_type: mime, data } });
      }
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(renderModel)}:generateContent?key=${encodeURIComponent(renderApiKey)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: requestParts }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        toast.error(`Render failed (${res.status})`);
        console.error("Render error:", errText);
        return;
      }
      const json = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      // Accept both snake_case (REST docs) and camelCase (SDK/proto-JSON) field names.
      const imgPart = parts.find((p: { inline_data?: { data?: string; mime_type?: string }; inlineData?: { data?: string; mimeType?: string } }) =>
        p.inline_data?.data || p.inlineData?.data
      );
      if (!imgPart) {
        const finishReason = json?.candidates?.[0]?.finishReason;
        const blockReason = json?.promptFeedback?.blockReason;
        const detail = blockReason ? `blocked: ${blockReason}` : finishReason ? `finish: ${finishReason}` : "no image part";
        toast.error(`Model returned no image (${detail})`);
        console.error("Render response:", json);
        return;
      }
      const inline = imgPart.inline_data ?? imgPart.inlineData;
      const mime = inline.mime_type ?? inline.mimeType ?? "image/png";
      setRenderResultUrl(`data:${mime};base64,${inline.data}`);
      toast.success("Render complete");
    } catch (e) {
      toast.error("Render error");
      console.error(e);
    } finally {
      setRenderBusy(false);
    }
  };

  /** Submit a video-generation job to Veo (long-running operation), poll until
   *  it finishes, then surface the resulting MP4 in a <video> tag with a Download
   *  link. Veo accepts an optional reference image (image-to-video) and a text
   *  prompt; multi-image isn't supported by the current Veo API, so we send the
   *  first selected snapshot only (falling back to the live canvas capture). */
  const handleRenderVideo = async () => {
    if (!renderApiKey.trim()) {
      toast.error("Add a Google AI Studio API key first");
      return;
    }
    try {
      setVideoBusy(true);
      setVideoResultUrl(null);
      setVideoStatus("Preparing request…");
      try { localStorage.setItem("video-model-v1", videoModel); } catch { /* ignore */ }

      // Pick a reference image: first user-selected snapshot only (no live-canvas
      // fallback for video — image-to-video should be opt-in via Snapshot+select).
      let refUrl: string | null = null;
      if (renderSnapshots && renderSelectedViews.length > 0) {
        const sel = renderSnapshots.find((s) => s.view === renderSelectedViews[0]);
        if (sel?.dataUrl) refUrl = sel.dataUrl;
      }
      const refMime = refUrl?.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
      const refB64 = refUrl ? (refUrl.split(",")[1] ?? "") : "";

      // Veo image-to-video. Veo 3.1 expects `image.inlineData.{mimeType,data}`
      // for the first-frame image (the flat `image.imageBytes` shape used by
      // older Veo 2 previews is rejected with "imageBytes isn't supported by
      // this model"). If no snapshot is selected we omit `image` entirely and
      // the model runs text-to-video.
      const startEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(videoModel)}:predictLongRunning`;
      const startBody: Record<string, unknown> = {
        instances: [
          {
            prompt: videoPrompt,
            ...(refB64 ? { image: { inlineData: { mimeType: refMime, data: refB64 } } } : {}),
          },
        ],
        // Conservative defaults — short clip, 16:9 cinematic frame, 720p.
        // Note: the public Veo REST docs show `durationSeconds` as a string, but
        // the live API actually rejects strings ("needs to be a number"). Use a
        // numeric value here.
        parameters: { durationSeconds: 8, aspectRatio: "16:9", resolution: "720p" },
      };
      if (refB64) {
        setVideoStatus("Sending with reference image…");
      }
      const startRes = await fetch(startEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": renderApiKey,
        },
        body: JSON.stringify(startBody),
      });
      if (!startRes.ok) {
        const errText = await startRes.text();
        // Extract Google's structured error message if present so the user sees
        // the actual cause (e.g. "Model not found", "API not enabled for project",
        // "Quota exceeded") rather than just an HTTP code.
        let detail = errText;
        try {
          const parsed = JSON.parse(errText);
          detail = parsed?.error?.message ?? errText;
        } catch { /* not JSON */ }
        if (startRes.status === 404) {
          toast.error(
            `Veo 404 — model "${videoModel}" not available on this key. Try veo-3.1-generate-preview or veo-3.1-lite-generate-preview, and ensure your Google AI Studio key has Veo (paid tier) enabled.`,
            { duration: 12000 },
          );
        } else {
          toast.error(`Video request failed (${startRes.status}): ${detail.slice(0, 200)}`, { duration: 10000 });
        }
        console.error("Video start error:", errText);
        return;
      }
      const startJson = await startRes.json();
      const opName: string | undefined = startJson?.name;
      if (!opName) {
        toast.error("No operation name returned");
        console.error("Veo start response:", startJson);
        return;
      }
      setVideoStatus("Queued — Veo can take 1-3 minutes…");

      // Poll the operation until done or timeout. Veo runs are typically 60-180s.
      const pollEndpoint = `https://generativelanguage.googleapis.com/v1beta/${opName}`;
      const POLL_INTERVAL_MS = 6000;
      const MAX_POLLS = 60; // ~6 minutes ceiling
      let opJson: unknown = null;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        setVideoStatus(`Rendering… (${(i + 1) * POLL_INTERVAL_MS / 1000}s elapsed)`);
        const pr = await fetch(pollEndpoint, {
          method: "GET",
          headers: { "x-goog-api-key": renderApiKey },
        });
        if (!pr.ok) {
          const t = await pr.text();
          console.error("Veo poll error:", t);
          continue;
        }
        const pj = await pr.json();
        if (pj?.done) { opJson = pj; break; }
      }
      if (!opJson) {
        toast.error("Video generation timed out");
        return;
      }
      // The response shape varies between docs versions and model variants —
      // walk the result tree generically to find ANY video URI or inline bytes.
      // Logs the full response so we can see what Veo actually returned if extraction fails.
      // eslint-disable-next-line no-console
      console.log("Veo final response:", opJson);
      const findVideoPayload = (node: unknown): { uri?: string; bytes?: string; mimeType?: string } | null => {
        if (!node || typeof node !== "object") return null;
        const obj = node as Record<string, unknown>;
        // Common Veo shapes we've seen across revisions:
        //   { video: { uri: "..." } }
        //   { video: { videoBytes: "<base64>", mimeType: "video/mp4" } }
        //   { videoUri: "..." }
        //   { uri: "..." }   (deep enough to be a media URI)
        //   { bytesBase64Encoded: "<base64>", mimeType: "video/mp4" }
        if (typeof obj.uri === "string" && /\.(mp4|webm)|generativelanguage|videofile/i.test(obj.uri)) {
          return { uri: obj.uri };
        }
        if (typeof obj.videoUri === "string") return { uri: obj.videoUri };
        if (typeof obj.videoBytes === "string") {
          return { bytes: obj.videoBytes, mimeType: (typeof obj.mimeType === "string" ? obj.mimeType : "video/mp4") };
        }
        if (typeof obj.bytesBase64Encoded === "string" && typeof obj.mimeType === "string" && (obj.mimeType as string).startsWith("video/")) {
          return { bytes: obj.bytesBase64Encoded, mimeType: obj.mimeType as string };
        }
        // Recurse into known container fields first, then any others.
        const keys = ["video", "generatedSamples", "generatedVideos", "samples", "response", "generateVideoResponse", "result", "predictions"];
        for (const k of keys) {
          if (obj[k] !== undefined) {
            const hit = findVideoPayload(obj[k]);
            if (hit) return hit;
          }
        }
        // Arrays and any remaining nested objects.
        for (const v of Object.values(obj)) {
          if (Array.isArray(v)) {
            for (const it of v) {
              const hit = findVideoPayload(it);
              if (hit) return hit;
            }
          } else if (v && typeof v === "object") {
            const hit = findVideoPayload(v);
            if (hit) return hit;
          }
        }
        return null;
      };
      const payload = findVideoPayload(opJson);
      if (!payload) {
        toast.error("Veo finished but no video URI/bytes found — check console for the raw response", { duration: 10000 });
        return;
      }

      // Inline-bytes branch: convert base64 directly to a Blob URL, no extra fetch.
      if (payload.bytes) {
        const byteChars = atob(payload.bytes);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArr], { type: payload.mimeType ?? "video/mp4" });
        setVideoResultUrl(URL.createObjectURL(blob));
        setVideoStatus("");
        toast.success("Video ready");
        return;
      }

      const firstUri = payload.uri!;
      // Veo's URI requires the API key — sent as the `x-goog-api-key` header so
      // it doesn't leak into Referer / server logs the way `?key=` would.
      setVideoStatus("Downloading video…");
      const vidRes = await fetch(firstUri, {
        method: "GET",
        headers: { "x-goog-api-key": renderApiKey },
      });
      if (!vidRes.ok) {
        toast.error(`Video fetch failed (${vidRes.status})`);
        return;
      }
      const blob = await vidRes.blob();
      const objUrl = URL.createObjectURL(blob);
      setVideoResultUrl(objUrl);
      setVideoStatus("");
      toast.success("Video ready");
    } catch (e) {
      toast.error("Video render error");
      console.error(e);
    } finally {
      setVideoBusy(false);
    }
  };

  return (
  <div className="shrink-0 border-t border-slate-200 bg-slate-50" style={panelExpanded ? { maxHeight: "45%" } : undefined}>
    <button
      type="button"
      className="flex w-full items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-left"
      onClick={() => onPanelExpandedChange((v) => !v)}
    >
      <span className="text-sm font-semibold">Global Tools</span>
      <span className="text-[11px] text-slate-400">{panelExpanded ? "▼" : "▶"}</span>
    </button>
    {panelExpanded && (
      <ScrollArea className="h-full max-h-[45vh]">
        <div className="space-y-2 p-3">

          {/* Compute Semantics */}
          <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => onAreaSemanticsExpandedChange((v) => !v)}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Compute Semantics</span>
              <span className="text-[11px] text-slate-400">{areaSemanticsExpanded ? "▼" : "▶"}</span>
            </button>
            {areaSemanticsExpanded && <>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                onClick={onComputeSemantics}
              >
                Compute Semantics for all rooms
              </Button>
              {Object.keys(regionSemanticsById).length === 0 ? (
                <p className="text-[9px] text-slate-400">Click to derive facades, proximity flags, area, depth and aspect ratio for every room. Results are cached and used by Rule Book and other tools.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-1 text-[9px] leading-[1.4] text-slate-700 font-mono">
                  {visibleRooms.filter((r) => regionSemanticsById[r.id]).map((r) => {
                    const s = regionSemanticsById[r.id];
                    const displayId = `Room${String(visibleRooms.indexOf(r) + 1).padStart(3, "0")}`;
                    return (
                      <div key={r.id} className="flex justify-between gap-2">
                        <span className="text-slate-400">{displayId}</span>
                        <span>f={s.facadeCount} a={s.areaM2.toFixed(1)}m² d={s.depthM.toFixed(1)}m{s.nearCore ? " core" : ""}{s.isCorner ? " cnr" : s.isInterior ? " int" : ""}</span>
                      </div>
                    );
                  })}
                  <div className="mt-1 border-t border-slate-200 pt-1 text-slate-400">
                    {Object.keys(regionSemanticsById).length} / {visibleRooms.length} rooms cached
                  </div>
                </div>
              )}
              <p className="text-[9px] text-slate-400">Thresholds: facade 0.5 m, Core 1.5 m, Stair 2 m, Corridor 0.5 m, Entry 3 m.</p>
            </>}
          </div>

          {/* Clean Walls — removed at user request. */}

          {/* Test block moved below the Commands section. */}

          {/* Apply JSON */}
          <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => onJsonExpandedChange((v) => !v)}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Apply JSON</span>
              <span className="text-[11px] text-slate-400">{jsonExpanded ? "▼" : "▶"}</span>
            </button>
            {jsonExpanded && <>
              {/* AI Assist */}
              <div className="rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => onAiChatExpandedChange((v) => !v)}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Generate with AI</span>
                  <span className="text-[11px] text-slate-400">{aiChatExpanded ? "▼" : "▶"}</span>
                </button>
                {aiChatExpanded && <>
                  <div>
                    <span className="text-[10px] text-slate-500">Prompt</span>
                    <textarea
                      className="mt-0.5 h-20 w-full resize-y rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
                      placeholder="e.g. For Core rooms split 40:60, for Service rooms draw a skeleton."
                      value={aiPrompt}
                      onChange={(e) => onAiPromptChange(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                  <details className="text-[10px]">
                    <summary className="cursor-pointer text-slate-500">API settings</summary>
                    <div className="mt-1 space-y-1">
                      <div>
                        <span className="text-[10px] text-slate-500">Gemini API key</span>
                        <input
                          type="password"
                          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-mono"
                          placeholder="AIza..."
                          value={aiApiKey}
                          onChange={(e) => onAiApiKeyChange(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500">Model</span>
                        <input
                          type="text"
                          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-mono"
                          value={aiModel}
                          onChange={(e) => onAiModelChange(e.target.value)}
                          placeholder="gemini-3-flash-preview"
                        />
                      </div>
                    </div>
                  </details>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-[11px]"
                    disabled={aiBusy || !aiPrompt.trim() || !aiApiKey.trim()}
                    onClick={onAiGenerate}
                    title="Generate JSON into the textarea below. Review, then press Apply JSON."
                  >
                    {aiBusy ? "Generating…" : "Generate → fill JSON below"}
                  </Button>
                </>}
              </div>

              {/* Sample JSONs — quick-start recipes. Handlers are placeholders for now. */}
              <div className="rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setSampleJsonsExpanded((v) => !v)}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Sample JSONs</span>
                  <span className="text-[11px] text-slate-400">{sampleJsonsExpanded ? "▼" : "▶"}</span>
                </button>
                {sampleJsonsExpanded && <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start text-[11px]"
                    onClick={() => {
                      onJsonTextChange(SAMPLE_1_SITE_TO_FOOTPRINT);
                      toast.success("Loaded Sample 1: Site to Building Footprint");
                    }}
                  >
                    Sample 1: Site to Building Footprint
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start text-[11px]"
                    onClick={() => toast.info("Sample 2 — handler not wired yet")}
                  >
                    Sample 2: City to Site Plans
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start text-[11px]"
                    onClick={() => {
                      onJsonTextChange(SAMPLE_3_FOOTPRINT_TO_FURNITURE);
                      toast.success("Loaded Sample 3: Building Footprint to Furniture Placement");
                    }}
                  >
                    Sample 3: Building Footprint to Furniture Placement
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start text-[11px]"
                    onClick={() => toast.info("Sample 4 — handler not wired yet")}
                  >
                    Sample 4: Existing City into Buildings
                  </Button>
                </>}
              </div>

              <div
                className={`rounded border-2 border-dashed p-2 text-center text-[10px] transition-colors ${jsonDragOver ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-slate-50"}`}
                onDragOver={(e) => { e.preventDefault(); onJsonDragOverChange(true); }}
                onDragLeave={() => onJsonDragOverChange(false)}
                onDrop={async (e) => {
                  e.preventDefault();
                  onJsonDragOverChange(false);
                  const file = e.dataTransfer.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    onJsonTextChange(text);
                    toast.success(`Loaded ${file.name}`);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    toast.error(`Read failed: ${msg}`);
                  }
                }}
              >
                <span className="text-slate-500">Drop a .json file here, or </span>
                <label className="cursor-pointer text-sky-600 underline">
                  browse
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const text = await file.text();
                        onJsonTextChange(text);
                        toast.success(`Loaded ${file.name}`);
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        toast.error(`Read failed: ${msg}`);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Recipe JSON</span>
                  {jsonText && (
                    <button
                      type="button"
                      className="text-[9px] text-red-500 hover:underline"
                      onClick={() => onJsonTextChange("")}
                    >
                      clear
                    </button>
                  )}
                </div>
                <textarea
                  className="mt-0.5 h-32 w-full resize-y rounded-md border border-slate-200 bg-white px-1.5 py-1 font-mono text-[10px]"
                  placeholder={`{\n  "rooms": [\n    {\n      "match": { "region": "Core" },\n      "operations": [\n        { "tool": "split", "params": { "count": 2, "mode": "ratio", "ratios": [40, 60] }, "commit": true }\n      ]\n    },\n    {\n      "match": { "region": "Service" },\n      "operations": [\n        { "tool": "skeleton", "params": { "type": "straight-skeleton" } }\n      ]\n    }\n  ]\n}`}
                  value={jsonText}
                  onChange={(e) => onJsonTextChange(e.target.value)}
                  spellCheck={false}
                />
                <span className="text-[9px] text-slate-400">
                  Multi-room: "rooms[].match" selects rooms by region, label, zone, id, roomType, or area. Each op can set "commit": true (permanent) or false (live preview); omit to use the recipe-wide mode. Legacy "operations[]" (no "rooms") targets the selected room.{" "}
                  Tools: inset, regime-inset, split, optimise-rect, place-object, voronoi, cvt, bsp, delaunay, skeleton, convex-hull, rect-decomp, smoothing, mesh, convex-decomp.
                </span>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                disabled={!jsonText.trim()}
                onClick={onApplyJsonCommit}
                title="Apply the recipe. Set per-op commit:false in the JSON for live preview."
              >
                Apply JSON
              </Button>
            </>}
          </div>

          {/* Commands */}
          <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => onCommandsExpandedChange((v) => !v)}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Commands</span>
              <span className="text-[11px] text-slate-400">{commandsExpanded ? "▼" : "▶"}</span>
            </button>
            {commandsExpanded && <>
              <div className="relative">
                <input
                  type="text"
                  className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px]"
                  placeholder="e.g. inset by 0.3 m then split 60:40 and round corners 30%"
                  value={commandsInput}
                  onChange={(e) => onCommandsInputChange(e.target.value)}
                  onFocus={() => onCommandsFocusedChange(true)}
                  onBlur={() => setTimeout(() => onCommandsFocusedChange(false), 150)}
                  spellCheck={false}
                />
                {commandsFocused && commandSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                    {commandSuggestions.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        className="block w-full px-2 py-1 text-left text-[10px] hover:bg-slate-50"
                        onMouseDown={(e) => { e.preventDefault(); onCommandsInputChange(c.example); }}
                      >
                        <div className="font-medium text-slate-700">{c.label}</div>
                        <div className="font-mono text-[9px] text-slate-400">{c.example}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-[9px] text-slate-400">
                Chain commands with &quot;then&quot;, &quot;and&quot;, &quot;;&quot; or newlines. Click a suggestion to fill.
              </span>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Semantic fallback</span>
                <Button
                  variant={semanticState === "ready" ? "default" : "outline"}
                  size="sm"
                  className="h-6 text-[10px]"
                  disabled={semanticState === "loading"}
                  onClick={onLoadSemanticLayer}
                  title="Load an on-device embedding model (~25 MB) to match unusual phrasings by meaning"
                >
                  {semanticState === "off" && "Enable"}
                  {semanticState === "loading" && "Loading model…"}
                  {semanticState === "ready" && "Ready ✓"}
                  {semanticState === "error" && "Retry"}
                </Button>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-[11px]"
                  disabled={!commandsInput.trim()}
                  onClick={onCommandsPreview}
                  title="Match commands and preview them (non-destructive)"
                >
                  Interact
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-[11px]"
                  disabled={!commandsInput.trim()}
                  onClick={onCommandsRun}
                >
                  Run
                </Button>
              </div>

              <details className="text-[10px]">
                <summary className="cursor-pointer text-slate-500">Command vocabulary ({commandCatalogue.length})</summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {commandCatalogue.map((c, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="font-mono text-[9px] text-slate-600 truncate">{c.example}</span>
                      <button
                        type="button"
                        className="text-[9px] text-sky-600 hover:underline"
                        onClick={() => onCommandsInputChange(c.example)}
                      >
                        use
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </>}
          </div>

          {/* Test — foldable dev shortcut. Sits below Commands. */}
          <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setTestExpanded((v) => !v)}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Test</span>
              <span className="text-[11px] text-slate-400">{testExpanded ? "▼" : "▶"}</span>
            </button>
            {testExpanded && <>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                onClick={onTestDrawPolygon}
              >
                Random Site Cascade
              </Button>
              <p className="text-[9px] text-slate-400">Drops a random pentagonal Site + Buildable + Footprint set on the canvas.</p>
            </>}
          </div>

          {/* Render — AI image render of the current 3D snapshot. */}
          <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setRenderExpanded((v) => !v)}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Render</span>
              <span className="text-[11px] text-slate-400">{renderExpanded ? "▼" : "▶"}</span>
            </button>
            {renderExpanded && <>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                disabled={snapshotBusy}
                onClick={handleSnapshot}
              >
                {snapshotBusy ? "Capturing…" : "Snapshot (6 views from 3D)"}
              </Button>
              {renderSnapshots && renderSnapshots.length > 0 && (() => {
                // Display labels for the snapshot view codes — keeps the 360 / cubemap entries
                // human-readable while leaving the underlying view-code unchanged.
                const VIEW_LABELS: Record<string, string> = {
                  front: "Front", back: "Back", left: "Left", right: "Right",
                  top: "Top", isometric: "Isometric",
                  composite: "All Views (composite)",
                  panorama: "360 Panorama",
                  "cube-px": "Cube +X", "cube-nx": "Cube -X",
                  "cube-py": "Cube +Y (Up)", "cube-ny": "Cube -Y (Down)",
                  "cube-pz": "Cube +Z", "cube-nz": "Cube -Z",
                };
                const selectedSet = new Set(renderSelectedViews);
                const toggleView = (v: string) => {
                  setRenderSelectedViews((prev) =>
                    prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                  );
                };
                return (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-slate-600">
                        Pick view(s) — {renderSelectedViews.length} selected
                      </p>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="text-[9px] text-slate-500 underline-offset-2 hover:underline"
                          onClick={() => setRenderSelectedViews(renderSnapshots.map((s) => s.view))}
                        >
                          all
                        </button>
                        <span className="text-[9px] text-slate-300">·</span>
                        <button
                          type="button"
                          className="text-[9px] text-slate-500 underline-offset-2 hover:underline"
                          onClick={() => setRenderSelectedViews([])}
                        >
                          none
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {renderSnapshots.map((s) => {
                        const checked = selectedSet.has(s.view);
                        return (
                          <button
                            key={s.view}
                            type="button"
                            onClick={() => toggleView(s.view)}
                            aria-pressed={checked}
                            className={`relative flex flex-col items-center gap-0.5 rounded border p-0.5 text-[9px] transition ${
                              checked
                                ? "border-sky-500 ring-1 ring-sky-300 bg-sky-50/50"
                                : "border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            {/* Checkmark badge — clearer "this is selected" affordance than a ring alone. */}
                            {checked && (
                              <span
                                aria-hidden
                                className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sky-500 text-[8px] font-bold text-white shadow"
                              >
                                ✓
                              </span>
                            )}
                            <img src={s.dataUrl} alt={s.view} className="w-full rounded-sm" />
                            <span className="text-slate-600">{VIEW_LABELS[s.view] ?? s.view}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <div>
                <p className="mb-1 text-[10px] font-semibold text-slate-600">API Key (Google AI Studio)</p>
                <Input
                  type="password"
                  placeholder="AIza…"
                  value={renderApiKey}
                  onChange={(e) => setRenderApiKey(e.target.value)}
                  className="h-7 text-[11px]"
                />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold text-slate-600">Model</p>
                <Input
                  value={renderModel}
                  onChange={(e) => setRenderModel(e.target.value)}
                  className="h-7 text-[11px]"
                />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold text-slate-600">Prompt</p>
                <textarea
                  value={renderPrompt}
                  onChange={(e) => setRenderPrompt(e.target.value)}
                  className="min-h-[60px] w-full rounded border border-slate-200 bg-white p-1.5 text-[11px]"
                />
              </div>
              <Button
                variant="default"
                size="sm"
                className="w-full text-[11px]"
                disabled={renderBusy}
                onClick={handleRender}
              >
                {renderBusy ? "Rendering…" : "Render snapshot of 3D view"}
              </Button>
              <p className="text-[9px] text-slate-400">
                Captures the visible canvas (3D if toggled on) and sends it to Gemini with the prompt. Result appears below.
              </p>
              {renderResultUrl && (
                <div className="space-y-1">
                  <img
                    src={renderResultUrl}
                    alt="Rendered output"
                    className="w-full rounded border border-slate-200"
                  />
                  <a
                    href={renderResultUrl}
                    download="render.png"
                    className="text-[10px] text-sky-600 hover:underline"
                  >
                    Download
                  </a>
                </div>
              )}
              {/* ── Render Video (Veo) ──
                  Separate sub-section under the same Render block. Reuses the API
                  key + selected reference snapshot from above; adds its own model
                  field + cinematic prompt. */}
              <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Render Video (Veo)
                </p>
                <div>
                  <p className="mb-1 text-[10px] font-semibold text-slate-600">Video Model</p>
                  <Input
                    value={videoModel}
                    onChange={(e) => setVideoModel(e.target.value)}
                    className="h-7 text-[11px]"
                    placeholder="veo-3.0-generate-preview"
                  />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold text-slate-600">Video Prompt</p>
                  <textarea
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    rows={3}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-[11px]"
                  />
                </div>
                <Button
                  variant="default"
                  size="sm"
                  className="w-full text-[11px]"
                  disabled={videoBusy}
                  onClick={handleRenderVideo}
                >
                  {videoBusy ? (videoStatus || "Rendering video…") : "Render Video"}
                </Button>
                <p className="text-[9px] text-slate-400">
                  When a snapshot is selected above, its first image is used as the starting
                  reference frame (image-to-video). With no selection, runs text-to-video.
                  Generation is asynchronous — usually 1-3 minutes.
                </p>
                {videoResultUrl && (
                  <div className="space-y-1">
                    <video
                      src={videoResultUrl}
                      controls
                      className="w-full rounded border border-slate-200"
                    />
                    <a
                      href={videoResultUrl}
                      download="render.mp4"
                      className="text-[10px] text-sky-600 hover:underline"
                    >
                      Download video
                    </a>
                  </div>
                )}
              </div>
            </>}
          </div>

        </div>
      </ScrollArea>
    )}
  </div>
  );
};
