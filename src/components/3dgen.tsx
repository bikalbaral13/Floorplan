import { useEffect, useState } from "react";
import ImageAnnotator, { ExtendedAnnotation } from "./annotation";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2, Download, ArrowLeft, ArrowRight, Check, Trash2, X, Upload } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getDataSpecificById,
  postServiceByEntity,
  uploadImageToS3,
  updateServiceByEntity,
} from "@/api/action";
import { fetchProjectByIdFromApi, isProjectsApiConfigured } from "@/api/projectsApi";
import Tabs from "./tabs";
import SimpleImageAnnotator from "./SimpleImageAnnotator";
import ImageAnnotatorNew from "./SimpleImageAnnotator";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
const ENTITY_ID = "69d0b54cad8abad1ca92d84b";

export default function ThreeDGen() {

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [imageSource, setImageSource] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Popup state
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [tempSaveData, setTempSaveData] = useState<{
    shapes: ExtendedAnnotation[];
    unit: string;
    scaleUnit: string;
    pixelsPerFoot: number | null;
  } | null>(null);

  const [formParams, setFormParams] = useState({
    floor_thickness: "0.2",
    wall_height: "3.0",
    scale_factor: "0.01",
    roof_thickness: "0.2",
    lintel_height: "2.1",
    sill_height: "1.0",
    texture_path: "",
    door_path: "",
    window_path: "",
    unit: "meters",
    scaleUnit: "meters",
    pixelsPerFoot: 0 || null,
    library_path: "/var/www/library"
  });

  const [pendingShape, setPendingShape] = useState<any>(null);
  const [activeFormShapeId, setActiveFormShapeId] = useState<string | null>(null);
  const [shapeMetadata, setShapeMetadata] = useState<Record<string, any>>({});
  const [scale, setScale] = useState({
    unit: "meters",
    pixelsPerFoot: 0 || null,
  });
  const handleShapeFinished = (shape: any) => {
    console.log("shapeMetadatashape", shape)
    if (shape.type === "area") {
      setAnnotations(prev => [...prev, shape]);
      setShapeMetadata(prev => ({
        ...prev,
        [shape.id]: {
          name: shape.displayName || "",
          Label: "wall",
          sill_height: formParams.sill_height,
          lintel_height: formParams.lintel_height,
          height: formParams.wall_height,
          path: ""
        }
      }));
      setPendingShape(null);
    } else {
      setPendingShape(shape);
    }
  };
  console.log("shapeMetadatapend", pendingShape)


  const handleConfirmShape = (shapes: any) => {
    if (!pendingShape) return;
    console.log("shapeMetadatapend", pendingShape)
    setActiveFormShapeId(pendingShape.id);
    setAnnotations(shapes);

    // Initialize metadata for this shape if not exists
    setShapeMetadata(prev => ({
      ...prev,
      [pendingShape.id]: prev[pendingShape.id] || {
        name: pendingShape.displayName || "",
        Label: "wall", // Default label
        sill_height: formParams.sill_height,
        lintel_height: formParams.lintel_height,
        height: formParams.wall_height,
        height_from_floor: "0",
        path: ""
      }
    }));

    setPendingShape(null);
  };
  console.log("shapeMetadata", shapeMetadata)
  const handleDiscardShape = (shapes: any) => {
    if (!pendingShape) return;
    console.log("shapeMetadata", pendingShape)
    console.log("shapeMetadatafilter", annotations.filter(s => s.id !== pendingShape.id))
    setAnnotations(shapes.filter(s => s.id !== pendingShape.id));
    setPendingShape(null);
  };

  const handleMetadataChange = (id: string, field: string, value: any) => {
    setShapeMetadata(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value
      }
    }));
  };

  const handleSplit = (oldId: string, newIds: string[]) => {
    setShapeMetadata(prev => {
      const oldMeta = prev[oldId] || {};
      const next = { ...prev };

      // Left/Top - Copy metadata
      next[newIds[0]] = { ...oldMeta };

      // Middle - New metadata (defaults)
      next[newIds[1]] = {
        name: (oldMeta.name || "Element") + "-Middle",
        Label: "wall",
        sill_height: formParams.sill_height,
        lintel_height: formParams.lintel_height,
        height: formParams.wall_height,
        // ...formParams 
      };

      // Right/Bottom - Copy metadata
      next[newIds[2]] = { ...oldMeta };

      return next;
    });
  };

  const handleSegmentClick = (shapeId: string, segmentIndex: number) => {
    console.log("Segment clicked:", shapeId, segmentIndex);
    const segmentId = `${shapeId}-seg-${segmentIndex}`;

    // Initialize metadata for segment if not exists
    if (!shapeMetadata[segmentId]) {
      setShapeMetadata(prev => ({
        ...prev,
        [segmentId]: {
          name: `Segment ${segmentIndex + 1}`,
          Label: "wall",
          sill_height: formParams.sill_height,
          lintel_height: formParams.lintel_height,
          height: formParams.wall_height,
        }
      }));
    }

    setActiveFormShapeId(segmentId);
  };

  const getFirstPageFromPDF = async (file: File): Promise<Blob> => {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    return new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), "image/png")
    );
  };
  const { id } = useParams<{ id?: string }>();
  const initCanvas = async () => {
    const WIDTH = 800;
    const HEIGHT = 750;

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // setImageSource(canvas);

    const file = await canvasToFile(canvas);
    setUploadedFile(file); // ✅ same setter
  };
  const canvasToFile = (
    canvas: HTMLCanvasElement,
    filename = "cropped.png"
  ): Promise<File> => {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) return;
        resolve(new File([blob], filename, { type: blob.type }));
      }, "image/png");
    });
  };
  // Load file from ID or location state
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setIsLoading(true);
      try {
        if (id) {
          const response = await getDataSpecificById("69d0b54cad8abad1ca92d84b", id);
          if (response.success && response.data?.rooms?.[0]?.UploadedFile) {
            setImageSource(response.data.rooms[0].UploadedFile);
            setAnnotations(response.data.rooms[0].Annotations);
            setShapeMetadata(response.data.rooms[0].shapeMetadata);
            setData(response.data.rooms);
            setScale({ pixelsPerFoot: response.data.rooms[0].scale, unit: response.data.rooms[0].unit });

          }
        }

        else {
          const projectIdQ = searchParams.get("projectId");
          const loadKeyQ = searchParams.get("loadKey");
          if (projectIdQ && loadKeyQ && isProjectsApiConfigured()) {
            const proj = await fetchProjectByIdFromApi(projectIdQ);
            if (!isMounted) return;
            if (proj?.activeGalleryLoadKey !== loadKeyQ) {
              toast.error("This project image link is outdated. Open the image again from the project.");
              navigate(`/projects/${projectIdQ}`);
              return;
            }
            const galleryUrl = proj?.activeGalleryImageUrl;
            if (galleryUrl) {
              const response = await fetch(galleryUrl);
              const blob = await response.blob();
              const convertedFile = new File([blob], "stored-image.png", {
                type: blob.type,
              });
              if (isMounted) {
                setImageSource(galleryUrl);
                setUploadedFile(convertedFile);
              }
              return;
            }
            toast.error("No image selected on this project.");
            navigate(`/projects/${projectIdQ}`);
            return;
          }

          const file = location.state?.file;
          if (file) {
            if (file instanceof File) {
              console.log("file", file)
              if (file.type === "application/pdf") {
                const firstPage = await getFirstPageFromPDF(file);
                const imageFile = new File([firstPage], "pdf-page-1.png", { type: "image/png" });
                setUploadedFile(imageFile);
              } else {
                setUploadedFile(file);

              }

            }
            else if (typeof file === "string") {
              const response = await fetch(file);
              const blob = await response.blob();
              const convertedFile = new File([blob], "stored-image.png", {
                type: blob.type,
              });

              setImageSource(file);
              console.log("file", file)
              setUploadedFile(convertedFile);
            }
          } else {
            await initCanvas();

          }
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, [id, location.state?.file, navigate, searchParams]);
  console.log("pixelsPerFoot", scale)

  const handleClose = () => {
    navigate(-1);
  };


  const restoreFromJSON = (json: any) => {
    if (!json.elements || !Array.isArray(json.elements)) return;

    if (json.global_settings) {
      setFormParams(prev => ({
        ...prev,
        wall_height: json.global_settings.wall_height?.toString() || prev.wall_height,
        lintel_height: json.global_settings.lintel_height?.toString() || prev.lintel_height,
        sill_height: json.global_settings.sill_height?.toString() || prev.sill_height,
        floor_thickness: json.global_settings.floor_thickness?.toString() || prev.floor_thickness,
        library_path: json.global_settings.library_path || prev.library_path,
        pixelsPerFoot: json.global_settings.scale || prev.pixelsPerFoot,
      }));
      setScale(prev => ({
        ...prev,
        pixelsPerFoot: json.global_settings.scale || prev.pixelsPerFoot,
      }));
    }

    const newAnnotations: any[] = [];
    const newMetadata: Record<string, any> = {};

    const elementsByBaseId: Record<string, any[]> = {};
    json.elements.forEach((el: any) => {
      let baseId = el.id;
      if (el.id.includes("-seg-")) {
        baseId = el.id.split("-seg-")[0];
      }
      if (!elementsByBaseId[baseId]) {
        elementsByBaseId[baseId] = [];
      }
      elementsByBaseId[baseId].push(el);
    });

    Object.entries(elementsByBaseId).forEach(([baseId, elements]) => {
      if (elements.length > 1 || (elements.length === 1 && elements[0].id.includes("-seg-"))) {
        // Area Reconstruction
        elements.sort((a, b) => {
          const idxA = parseInt(a.id.split("-seg-")[1] || "0");
          const idxB = parseInt(b.id.split("-seg-")[1] || "0");
          return idxA - idxB;
        });

        const points: number[] = [];
        elements.forEach((el) => {
          if (el.points && el.points.length > 0) {
            points.push(el.points[0].x, el.points[0].y);
          }
          newMetadata[el.id] = {
            ...el,
            openingType: el.name,
          };
        });

        newAnnotations.push({
          id: baseId,
          type: "area",
          points: points,
          color: elements[0].color || "#10b981",
          isClosed: true,
        });
      } else {
        // Highlight/Rectangle Reconstruction
        const el = elements[0];
        const newAnn: any = {
          id: el.id,
          type: "highlight",
          color: el.color || "#10b981",
        };

        if (el.points && el.points.length === 4) {
          const minX = Math.min(...el.points.map((p: any) => p.x));
          const minY = Math.min(...el.points.map((p: any) => p.y));
          const maxX = Math.max(...el.points.map((p: any) => p.x));
          const maxY = Math.max(...el.points.map((p: any) => p.y));
          newAnn.x = minX;
          newAnn.y = minY;
          newAnn.w = maxX - minX;
          newAnn.h = maxY - minY;
        } else if (el.points) {
          newAnn.points = el.points.flatMap((p: any) => [p.x, p.y]);
        }

        newAnnotations.push(newAnn);
        newMetadata[el.id] = {
          ...el,
          openingType: el.name,
        };
      }
    });

    setAnnotations(newAnnotations);
    setShapeMetadata(newMetadata);
  };

  const handleUploadJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        restoreFromJSON(json);
        toast.success("Annotations restored from JSON!");
      } catch (error) {
        console.error("Error parsing JSON:", error);
        toast.error("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
    // Reset input value to allow uploading the same file again
    event.target.value = "";
  };


  type AnyShape = any;

  /* ----------------- HELPERS ----------------- */
  const textCenter = (t: any) => ({
    x: t.x + (t.w ?? 0) / 2,
    y: t.y + (t.h ?? 0) / 2,
  });

  const pointInRect = (p: any, r: any) =>
    p.x >= r.x &&
    p.x <= r.x + r.w &&
    p.y >= r.y &&
    p.y <= r.y + r.h;

  // Ray-casting algorithm
  const pointInPolygon = (point: any, polygon: { x: number; y: number }[]) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x,
        yi = polygon[i].y;
      const xj = polygon[j].x,
        yj = polygon[j].y;

      const intersect =
        yi > point.y !== yj > point.y &&
        point.x <
        ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }
    return inside;
  };


  const shapeCenter = (shape: any) => ({
    x: shape.x + (shape.w ?? 0) / 2,
    y: shape.y + (shape.h ?? 0) / 2,
  });

  const distance = (a: any, b: any) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  /* ----------------- MAIN FORMATTER ----------------- */
  const formatAnnotations = (shapes: any[], options?: any, separator = " ") => {
    console.log("formatted", shapes)
    const metadata = shapeMetadata || {};
    console.log("formatted", metadata)
    const texts = shapes.filter(s => s.type === "text");
    const geometries = shapes.filter(s =>
      ["highlight", "area", "shape"].includes(s.type)
    );

    const isFeet = options?.unit === "ft" || options?.unit === "ft-in" || options?.unit === "feet";
    const toMeters = (val: any) => {
      const num = parseFloat(val);
      if (isNaN(num)) return 0;
      return isFeet ? (num / 3.280839895) : num;
    };

    // Map: shapeId -> labels
    const shapeLabels = new Map<string, string[]>();

    /* -------- TEXT → BEST SHAPE MATCH -------- */
    for (const text of texts) {
      const center = textCenter(text);
      let bestMatch: any = null;

      geometries.forEach((shape, index) => {
        let isInside = false;

        /* Rectangle */
        if (shape.type !== "area") {
          isInside = pointInRect(center, shape);
        }

        /* Polygon */
        if (shape.type === "area") {
          let poly = [];
          // Handle both [x, y, x, y] and [{x,y}, {x,y}] formats
          if (shape.points.length > 0 && typeof shape.points[0] === 'object') {
            poly = shape.points;
          } else {
            for (let i = 0; i < shape.points.length; i += 2) {
              poly.push({ x: shape.points[i], y: shape.points[i + 1] });
            }
          }
          isInside = pointInPolygon(center, poly);
        }

        if (!isInside) return;

        const sCenter =
          shape.type === "area"
            ? center // polygon centroid can be expensive → acceptable fallback
            : shapeCenter(shape);

        const score = distance(center, sCenter);

        if (
          !bestMatch ||
          score < bestMatch.score ||
          (score === bestMatch.score && index > bestMatch.index)
        ) {
          bestMatch = { shape, score, index };
        }
      });

      if (bestMatch) {
        const id = bestMatch.shape.id;
        if (!shapeLabels.has(id)) shapeLabels.set(id, []);
        shapeLabels.get(id)!.push(text.text);
      }
    }

    /* -------- FINAL SHAPE OUTPUT -------- */
    return geometries.map(shape => {
      let points: { x: number; y: number }[];

      if (shape.type !== "area") {
        points = [
          { x: shape.x, y: shape.y },
          { x: shape.x + shape.w, y: shape.y },
          { x: shape.x + shape.w, y: shape.y + shape.h },
          { x: shape.x, y: shape.y + shape.h },
        ];
      } else {
        let allPoints: { x: number, y: number }[] = [];
        if (shape.points.length > 0 && typeof shape.points[0] === 'object') {
          allPoints = shape.points;
        } else {
          for (let i = 0; i < shape.points.length; i += 2) {
            allPoints.push({ x: shape.points[i], y: shape.points[i + 1] });
          }
        }
        points = allPoints;
      }

      const labels = shapeLabels.get(shape.id);
      const label = labels?.length ? labels.join(separator) : undefined;
      console.log("metaadata", metadata)
      const meta = metadata[shape.id] || {};
      console.log("metaa", meta)

      const formatted: any = {
        id: shape.id,
        type: "highlight",
        color: shape.color,
        points,
      };
      const num = (v: any) =>
        v === undefined || v === null || v === "" ? undefined : Number(v);





      if (meta.Label || label) {
        const finalLabel = meta.Label || label;
        if (finalLabel !== "wall") {
          formatted.Label = finalLabel;
        }
        const lowerLabel = finalLabel.toLowerCase();

        if (lowerLabel.includes("floor")) {
          formatted.texture = "textures/floor/floor2";
          // formatted.thickness = 0.1;
        } else if (lowerLabel.includes("Floor object")) {
          formatted.path = meta.path || "assets/floorobject/floorobject1.glb";
          formatted.height = Number(meta.height)
          formatted.Label = "Object"
          formatted.placement = "Floor"
          formatted.clearance = 0
          formatted.direction = 0
          formatted.name = meta.name
          formatted.show_box = false
          formatted.show_text = false

        } else if (lowerLabel.includes("wallobject")) {
          formatted.path = meta.path || "assets/wallobject/wallobject1.glb";
          formatted.height = Number(meta.height)
          formatted.name = meta.name
          formatted.Label = "Object"
          formatted.placement = "Wall"
          formatted.height_from_floor = Number(meta.height_from_floor || 0)
          formatted.clearance = 0
          formatted.direction = 0
          formatted.show_box = true
          formatted.show_text = false

        }
        else if (lowerLabel.includes("ceilingobject")) {
          formatted.height = Number(meta.height || 1);
          formatted.path = meta.path || "assets/fan/fan0.glb";
          formatted.Label = "Object"
          formatted.placement = "Ceiling"
          formatted.name = meta.name
          formatted.clearance = 0
          formatted.direction = 0
          formatted.show_box = false
          formatted.show_text = false
        } else if (lowerLabel.includes("ceiling")) {
          formatted.texture = "textures/floor/floor1";
        } else if (lowerLabel.includes("window")) {
          formatted.sill_height = Number(meta.sill_height) || 0;
          formatted.lintel_height = Number(meta.lintel_height) || 0;
          formatted.path = meta.path || "assets/window/window0.glb";
        } else if (lowerLabel.includes("opening")) {
          formatted.sill_height = Number(meta.sill_height) || 0;
          formatted.lintel_height = Number(meta.lintel_height) || 0;
          formatted.path = meta.path || "assets/door/dooo.glb";
          formatted.name = meta.openingType
          formatted.Label = "Opening"
          formatted.show_text = false
        } else {
          formatted.texture = "textures/custom/custom1";
          formatted.Label = "Wall";
        }
      } else {
        formatted.texture = "textures/custom/custom1";
      }

      if (shape.type === "area") {
        const segs: any[] = [];
        const allPoints: { x: number; y: number }[] = points;

        const hiddenSegments = shape.hiddenSegments || [];
        const isClosed = shape.isClosed === true;

        if (allPoints.length >= 2) {
          // 👇 determine loop length
          const maxIndex = allPoints.length;


          for (let i = 0; i < maxIndex; i++) {
            if (hiddenSegments.includes(i)) continue;

            const p1 = allPoints[i];
            const p2 =
              allPoints[(i + 1) % allPoints.length] // close loop

            const segmentId = `${shape.id}-seg-${i}`;
            const baseMeta = metadata[segmentId] || {};

            const label = baseMeta.Label || baseMeta.name || "wall";
            const lowerLabel = label.toLowerCase();

            const finalMeta: any = {};

            /* ---------- FLOOR OBJECT ---------- */
            if (lowerLabel.includes("floor object")) {
              finalMeta.Label = "Object";
              finalMeta.name = baseMeta.name;
              finalMeta.path = baseMeta.path || "assets/floorobject/floorobject1.glb";
              finalMeta.height = num(baseMeta.height);
              finalMeta.show_box = false;
              finalMeta.show_text = false;
            }

            /* ---------- WALL OBJECT ---------- */
            else if (lowerLabel.includes("wallobject")) {
              finalMeta.Label = "WallObject";
              finalMeta.name = baseMeta.name;
              finalMeta.path = baseMeta.path || "assets/wallobject/wallobject1.glb";
              finalMeta.height = num(baseMeta.height);
              finalMeta.show_box = false;
              finalMeta.show_text = false;
            }

            /* ---------- CEILING OBJECT ---------- */
            else if (lowerLabel.includes("ceilingobject")) {
              finalMeta.Label = "CeilingObject";
              finalMeta.name = baseMeta.name;
              finalMeta.path =
                baseMeta.path || "assets/chandelier/chandelier1.glb";
              finalMeta.height = num(baseMeta.height) ?? 1;
              finalMeta.show_box = false;
              finalMeta.show_text = false;
            }

            /* ---------- OPENING ---------- */
            else if (lowerLabel.includes("opening")) {
              const openingType = baseMeta.openingType?.toLowerCase();

              finalMeta.Label = "Opening";
              finalMeta.name = baseMeta.openingType;
              finalMeta.show_text = false;

              finalMeta.sill_height = num(baseMeta.sill_height);
              finalMeta.lintel_height = num(baseMeta.lintel_height);

              if (openingType === "window") {
                finalMeta.path = baseMeta.path || "assets/window/window0.glb";
              } else {
                finalMeta.path = baseMeta.path || "assets/door/dooo.glb";
                finalMeta.sill_height = 0;
              }
            }

            /* ---------- FLOOR ---------- */
            else if (lowerLabel.includes("floor")) {
              finalMeta.Label = "Floor";
              finalMeta.texture = "textures/floor/floor2";
            }

            /* ---------- CEILING ---------- */
            else if (lowerLabel.includes("ceiling")) {
              finalMeta.Label = "Ceiling";
              finalMeta.texture = "textures/floor/floor1";
            }

            /* ---------- WALL (DEFAULT) ---------- */
            else {
              finalMeta.Label = "Wall";
              finalMeta.texture = "textures/wall/wall1";
            }

            segs.push({
              id: segmentId,
              type: "highlight",
              color: shape.color,
              points: [p1, p2],
              ...finalMeta
            });
          }
        }

        (formatted as any).segments = segs;
        // if(allPoints.length === 4){

        // }
      }

      console.log("formattedareaarea", formatted)
      if (shape.type === "area") {
        return formatted.segments;
      } else {
        return formatted;
      }


    });
  };

  type FinalShape = {
    id: string;
    type: string;
    color: string;
    points: { x: number; y: number }[];
    Label?: string;
    [key: string]: any;
  };

  const validateAndFilter = (shapes: FinalShape[]) => {

    return shapes.filter(shape => {
      console.log("validateAndFilter", shape)
      if (!shape.points || !Array.isArray(shape.points)) {
        console.log("validateAndFilter", shape)

        return shape;
      }

      // ❌ Missing or invalid numbers
      for (const p of shape.points) {
        if (
          p.x === undefined ||
          p.y === undefined ||
          Number.isNaN(p.x) ||
          Number.isNaN(p.y)
        ) {
          return false;
        }
      }

      // ❌ All points identical
      const firstPoint = shape.points[0];
      const samePoint = shape.points.every(
        p => p.x === firstPoint.x && p.y === firstPoint.y
      );
      if (samePoint) {
        return false;
      }

      return true;
    });
  }


  type Point = {
    x: number;
    y: number;
  };



  /* ===============================
     VALIDATE + CONNECT WALL LOGIC
  ================================ */

  const assignConnectedWall = (
    shapes: FinalShape[],
    tolerance = 5 // pixels distance threshold
  ): FinalShape[] => {
    // -------- 1. Validate shapes --------
    const validShapes = shapes.filter(shape => {
      if (!Array.isArray(shape.points) || shape.points.length < 2) return false;

      for (const p of shape.points) {
        if (
          p.x === undefined ||
          p.y === undefined ||
          Number.isNaN(p.x) ||
          Number.isNaN(p.y)
        ) {
          return false;
        }
      }

      const first = shape.points[0];
      if (
        shape.points.every(p => p.x === first.x && p.y === first.y)
      ) {
        return false;
      }

      return true;
    });

    // -------- 2. Collect wall segments --------
    const walls = validShapes.filter(
      s => s.Label === "Wall" && s.points.length === 2
    );

    // -------- 3. Assign nearest wall --------
    return validShapes.map(shape => {
      if (shape.Label !== "Object" || shape.placement !== "Wall") {
        return shape;
      }

      const center = getCenter(shape.points);

      let nearestWallId: string | null = null;
      let minDistance = Infinity;
      let autoConnected = false;

      for (const wall of walls) {
        const distance = getMinObjectToWallDistance(
          shape.points,
          wall.points[0],
          wall.points[1]
        );


        // Near check + closest wins
        if (distance <= tolerance && distance < minDistance) {
          minDistance = distance;
          nearestWallId = wall.id;
        }
      }

      return {
        ...shape,
        connected_wall: nearestWallId,
        auto_find_wall: nearestWallId ? false : true
      };
    });
  };

  /* ===============================
     HELPERS
  ================================ */

  const getCenter = (points: Point[]): Point => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2
    };
  };

  const getMinObjectToWallDistance = (
    objectPoints: Point[],
    wallA: Point,
    wallB: Point
  ): number => {
    let min = Infinity;

    for (const p of objectPoints) {
      const d = pointToSegmentDistance(p, wallA, wallB);
      min = Math.min(min, d);
    }

    return min;
  };


  const pointToSegmentDistance = (
    p: Point,
    a: Point,
    b: Point
  ): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    if (dx === 0 && dy === 0) {
      return Math.hypot(p.x - a.x, p.y - a.y);
    }

    const t =
      ((p.x - a.x) * dx + (p.y - a.y) * dy) /
      (dx * dx + dy * dy);

    const clampedT = Math.max(0, Math.min(1, t));

    const closest = {
      x: a.x + clampedT * dx,
      y: a.y + clampedT * dy
    };

    return Math.hypot(p.x - closest.x, p.y - closest.y);
  };


  const handleSave = async (
    shapes: ExtendedAnnotation[],
    file: File,
    uploadedFile: File | undefined,
    unit: string,
    scaleUnit: string,
    pixelsPerFoot: number | null
  ) => {
    console.log("hiddenSegments:", shapes)
    setAnnotations(shapes);
    const ppf = parseFloat(formParams.pixelsPerFoot);
    console.log("ppf", ppf);
    const calculatedScale = pixelsPerFoot > 0 ? (1 / (3.280839895 * pixelsPerFoot)) : 0.01;
    console.log("calculatedScale", calculatedScale);
    if (id) {
      // Upload snapshot to S3 and update backend record
      // const s3Url = await uploadImageToS3(file);
      if (data) {
        const updatedRooms = [...(data || [])];
        updatedRooms[0].Annotations = shapes;
        updatedRooms[0].shapeMetadata = shapeMetadata;
        updatedRooms[0].scale = pixelsPerFoot;
        updatedRooms[0].unit = unit;

        await updateServiceByEntity(ENTITY_ID, id, { rooms: updatedRooms });
      }
      navigate(`/3d-model/${id}`);
    } else {
      // Create and route if id is not present
      let upl;
      if (uploadedFile) {
        upl = await uploadImageToS3(uploadedFile);
      } else {
        upl = await uploadImageToS3(file)
      }
      const room = [
        {
          roomName: "Room 1",
          area: "",
          planImage: "",
          UploadedFile: upl,
          Annotations: shapes,
          shapeMetadata: shapeMetadata,
          unit: unit,
          scale: pixelsPerFoot,

        },
      ];

      try {
        const response = await postServiceByEntity(ENTITY_ID, {
          rooms: room,
        });



        if (response._id) {
          setData(response.data.rooms);
          navigate(`/3d-model/${response._id}`, { replace: true });
        }


      } catch (error) {
        console.error("Error creating record:", error);
      }
    }


    setTempSaveData({ shapes, unit, scaleUnit, pixelsPerFoot });
    setFormParams(prev => ({
      ...prev,
      unit: unit || prev.unit,
      scaleUnit: scaleUnit || prev.scaleUnit,
      pixelsPerFoot: unit === "ft" || unit === "ft-in" || unit === "feet" ? (1 / (3.280839895 * pixelsPerFoot)) : (1 / pixelsPerFoot)
    }));
    setShowConfigPopup(true);
  };

  const handleDownloadJSON = (pixelsPerFoot: number, unit: string, shapes: any) => {

    console.log("hiddenSegments", shapes);
    const formatted = formatAnnotations(shapes, { ...formParams, shapeMetadata });
    console.log("formattedareaarea", formatted);
    console.log("unit", unit);
    const result = formatted.flat();
    console.log("formattedareaarearesult", result);


    let validated = validateAndFilter(result);
    console.log("validated", validated);
    validated = assignConnectedWall(validated);
    console.log("validated", validated);


    const isFeet = unit === "ft" || unit === "ft-in" || unit === "feet";
    const toMeters = (val: string) => {
      const num = parseFloat(val);
      if (isNaN(num)) return 0;
      return isFeet ? (num / 3.280839895) : num;
    };
    const ppf = Number(pixelsPerFoot);
    console.log("calculatedScale", ppf);
    let calculatedScale = 0;
    if (isFeet) {
      calculatedScale = ppf > 0 ? (1 / (3.280839895 * ppf)) : 0.01;
    }
    else {
      calculatedScale = ppf > 0 ? (ppf) : 0.01;
    }
    console.log("calculatedScale", calculatedScale);
    const finalJson = {
      global_settings: {
        scale: calculatedScale,
        wall_height: Number(formParams.wall_height),
        lintel_height: Number(formParams.lintel_height),
        sill_height: Number(formParams.sill_height),
        floor_thickness: Number(formParams.floor_thickness),
        library_path: formParams.library_path
      },
      elements: validated
    };
    console.log("finalJson", finalJson);

    const blob = new Blob([JSON.stringify(finalJson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'annotation.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  console.log("annotations", annotations);
  const handleFinalProceed = async () => {
    if (!tempSaveData) return;

    setIsExporting(true);
    try {
      const formatted = formatAnnotations(tempSaveData.shapes, formParams);
      console.log("formatted", formatted);
      const resul = formatted.flat();

      let validated = validateAndFilter(resul);


      validated = assignConnectedWall(validated);
      console.log("validated", validated);

      const ppf = parseFloat(formParams.pixelsPerFoot);
      console.log("ppf", ppf);
      let calculatedScale = 0;
      if (formParams.unit === "ft" || formParams.unit === "ft-in" || formParams.unit === "feet") {
        calculatedScale = ppf > 0 ? (1 / (3.280839895 * ppf)) : 0.01;
      }
      else {
        calculatedScale = ppf > 0 ? (1 / ppf) : 0.01;
      }
      console.log("calculatedScale", calculatedScale);
      const toMeters = (val: string) => {
        const num = parseFloat(val);
        if (isNaN(num)) return 0;
        return formParams.unit === "ft" || formParams.unit === "ft-in" || formParams.unit === "feet" ? (num / 3.280839895) : num;
      };

      // Combine annotations with new parameters in the requested format
      const finalJson = {
        global_settings: {
          scale: Number(formParams.pixelsPerFoot),
          wall_height: Number(formParams.wall_height),
          lintel_height: Number(formParams.lintel_height),
          sill_height: Number(formParams.sill_height),
          floor_thickness: Number(formParams.floor_thickness),
          library_path: formParams.library_path
        },
        elements: validated
      };

      const jsonBlob = new Blob(
        [JSON.stringify(finalJson, null, 2)],
        { type: "application/json" }
      );

      const jsonFile = new File([jsonBlob], "annotation.json", {
        type: "application/json",
      });
      console.log("jsonFile", jsonFile);

      const formData = new FormData();
      formData.append("file", jsonFile);
      formData.append("blender_executable", "/usr/local/bin/blender");

      const response = await fetch(
        "https://tooluat.gettaskagent.com/threeD/json_to_glb_blender",
        {
          method: "POST",
          headers: {
            accept: "application/json",
          },
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error(`API failed: ${response.status}`);
      }

      const result = await response.json();
      console.log("GLB Response:", result);

      if (id) {
        // Update existing record with the 3D model URL
        const currentData = data || [{}];
        const updatedRooms = [...currentData];
        console.log("updatedRooms",updatedRooms)

        if (updatedRooms[0]) {
          console.log("updatedRooms",updatedRooms)
          updatedRooms[0].threedModel = result.url;
          updatedRooms[0].formattedJson = finalJson;
        }

        // Update record in backend
        await updateServiceByEntity("69d0b54cad8abad1ca92d84b", id, { rooms: updatedRooms });

        navigate(`/building-configurator/${id}`, { state: { file: result.url } });
      } else {
        navigate('/building-configurator', { state: { file: result.url } });
      }

      toast.success("3D Model generated successfully!");
      setShowConfigPopup(false);
    } catch (error) {
      console.error("Error generating 3D:", error);
      toast.error("Failed to generate 3D model. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };


  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-slate-900">
      {/* Main Editor Area */}
      <div className="relative flex-1 flex flex-col min-w-0">
        <div className="absolute top-3 left-16 z-50 flex items-center gap-3">
          <Tabs id={id} />
          <Button
            variant="outline"
            onClick={() => document.getElementById("json-upload")?.click()}
            className="flex items-center gap-2 bg-slate-800/80 backdrop-blur-md text-white border-white/10 hover:bg-slate-700/80 shadow-xl rounded-xl h-10 px-4 transition-all duration-300"
          >
            <Upload className="h-4 w-4 text-emerald-400" />
            <span className="font-medium">Upload JSON</span>
          </Button>
          <input
            id="json-upload"
            type="file"
            accept=".json"
            onChange={handleUploadJSON}
            className="hidden"
          />
        </div>

        {/* <div className="absolute top-2 right-12 z-50 flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handleDownloadJSON}
            className="flex items-center gap-2 bg-white shadow-sm rounded-full"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div> */}

        <div className="flex-1 relative">
          <ImageAnnotatorNew
            key={id}
            uploadedFile={uploadedFile}
            imageSource={imageSource}
            initialAnnotations={annotations}
            onSave={handleSave}
            onClose={handleClose}
            onAnnotationsChange={setAnnotations}
            onShapeFinished={handleShapeFinished}
            pendingShape={pendingShape}
            onConfirmShape={handleConfirmShape}
            onDiscardShape={handleDiscardShape}
            onShapeClick={(id) => setActiveFormShapeId(id)}
            inline
            scalee={scale}
            onSplit={handleSplit}
            onSegmentClick={handleSegmentClick}
            handleDownloadJSON={handleDownloadJSON}
          />

          {/* Confirm/Discard Action Buttons Overlay - MOVED TO SimpleImageAnnotator */}
        </div>
      </div>



      {/* Dynamic Input Form Sidebar */}
      {activeFormShapeId && (
        <div className="w-96 border-l border-white/10 bg-slate-900/80 backdrop-blur-2xl flex flex-col animate-in slide-in-from-right duration-500 shadow-2xl z-50 text-white">
          <Card className="flex-1 border-none shadow-none bg-transparent flex flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-white/10 py-4 px-6">
              <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                <div className="w-2 h-6 bg-emerald-500 rounded-full" />
                Element Details
              </CardTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setActiveFormShapeId(null)}
                className="text-white/60 hover:text-white hover:bg-white/10 rounded-full"
              >
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>

            <ScrollArea className="flex-1">
              <CardContent className="p-6 space-y-6">
                {/* <div className="space-y-2">
                  <Label className="text-white/80 font-medium">Element Name</Label>
                  <Input
                    value={shapeMetadata[activeFormShapeId]?.name || ""}
                    onChange={(e) => handleMetadataChange(activeFormShapeId, "name", e.target.value)}
                    placeholder="e.g. Wall_Main, Door_Entry"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-emerald-500/50 transition-all rounded-xl h-11"
                  />
                </div> */}

                <div className="space-y-2">
                  <Label className="text-white/80 font-medium">Element Type</Label>
                  <Select
                    value={shapeMetadata[activeFormShapeId]?.Label || "wall"}
                    onValueChange={(val) => handleMetadataChange(activeFormShapeId, "Label", val)}
                  >
                    <SelectTrigger className="bg-white/5 border-white/10 text-white focus:ring-emerald-500/20 rounded-xl h-11">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10 text-white">
                      <SelectItem value="wall">Wall</SelectItem>
                      <SelectItem value="ceiling">Ceiling</SelectItem>
                      <SelectItem value="flooring">Flooring</SelectItem>
                      <SelectItem value="wallObject">Wall Object</SelectItem>
                      <SelectItem value="ceilingObject">Ceiling Object</SelectItem>
                      <SelectItem value="Floor object">Floor Object</SelectItem>
                      <SelectItem value="opening">Opening (Door/Window)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="pt-4 border-t border-white/10 mt-6 space-y-5">
                  {shapeMetadata[activeFormShapeId]?.Label === "opening" && (
                    <>
                      <Label className="text-white/80 font-medium">Opening Type</Label>
                      <Select
                        value={shapeMetadata[activeFormShapeId]?.openingType}
                        onValueChange={(val) => handleMetadataChange(activeFormShapeId, "openingType", val)}
                      >
                        <SelectTrigger className="bg-white/5 border-white/10 text-white focus:ring-emerald-500/20 rounded-xl h-11">
                          <SelectValue placeholder="Select opening type" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10 text-white">
                          <SelectItem value="Door">Door</SelectItem>
                          <SelectItem value="Window">Window</SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-white/70 text-sm">Sill Height</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={shapeMetadata[activeFormShapeId]?.sill_height || ""}
                            onChange={(e) => handleMetadataChange(activeFormShapeId, "sill_height", e.target.value)}
                            className="bg-white/5 border-white/10 text-white rounded-xl"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-white/70 text-sm">Lintel Height</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={shapeMetadata[activeFormShapeId]?.lintel_height || ""}
                            onChange={(e) => handleMetadataChange(activeFormShapeId, "lintel_height", e.target.value)}
                            className="bg-white/5 border-white/10 text-white rounded-xl"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-white/70 text-sm">Library Path</Label>
                        <Input
                          placeholder="e.g. assets/door/wood_door.glb"
                          value={shapeMetadata[activeFormShapeId]?.path || ""}
                          onChange={(e) => handleMetadataChange(activeFormShapeId, "path", e.target.value)}
                          className="bg-white/5 border-white/10 text-white rounded-xl"
                        />
                      </div>
                    </>
                  )}

                  {shapeMetadata[activeFormShapeId]?.Label === "wallObject" && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-white/80 font-medium">Object Name</Label>
                        <Input
                          value={shapeMetadata[activeFormShapeId]?.name || ""}
                          onChange={(e) => handleMetadataChange(activeFormShapeId, "name", e.target.value)}
                          placeholder="e.g. Wall_Main, Door_Entry"
                          className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-emerald-500/50 transition-all rounded-xl h-11"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-white/70 text-sm">Object Height</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={shapeMetadata[activeFormShapeId]?.height || ""}
                            onChange={(e) => handleMetadataChange(activeFormShapeId, "height", e.target.value)}
                            className="bg-white/5 border-white/10 text-white rounded-xl"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-white/70 text-sm">Elevation from Floor</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={shapeMetadata[activeFormShapeId]?.height_from_floor || ""}
                            onChange={(e) => handleMetadataChange(activeFormShapeId, "height_from_floor", e.target.value)}
                            className="bg-white/5 border-white/10 text-white rounded-xl"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-white/70 text-sm">Library Path</Label>
                        <Input
                          placeholder="e.g. assets/furniture/shelf.glb"
                          value={shapeMetadata[activeFormShapeId]?.path || ""}
                          onChange={(e) => handleMetadataChange(activeFormShapeId, "path", e.target.value)}
                          className="bg-white/5 border-white/10 text-white rounded-xl"
                        />
                      </div>
                    </>
                  )}

                  {shapeMetadata[activeFormShapeId]?.Label === "Floor object" && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-white/80 font-medium">Object Name</Label>
                        <Input
                          value={shapeMetadata[activeFormShapeId]?.name || ""}
                          onChange={(e) => handleMetadataChange(activeFormShapeId, "name", e.target.value)}
                          placeholder="e.g. Sofa,Chair"
                          className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-emerald-500/50 transition-all rounded-xl h-11"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-white/70 text-sm">Object Height</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={shapeMetadata[activeFormShapeId]?.height || ""}
                          onChange={(e) => handleMetadataChange(activeFormShapeId, "height", e.target.value)}
                          className="bg-white/5 border-white/10 text-white rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-white/70 text-sm">Library Path</Label>
                        <Input
                          placeholder="e.g. assets/furniture/sofa.glb"
                          value={shapeMetadata[activeFormShapeId]?.path || ""}
                          onChange={(e) => handleMetadataChange(activeFormShapeId, "path", e.target.value)}
                          className="bg-white/5 border-white/10 text-white rounded-xl"
                        />
                      </div>
                    </>
                  )}

                  {(["wall", "ceiling", "flooring", "ceilingObject"].includes(shapeMetadata[activeFormShapeId]?.Label)) && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-white/70 text-sm">{shapeMetadata[activeFormShapeId]?.Label === "ceilingObject" ? "Height" : "Thickness"}</Label>
                        <Input
                          type="number"
                          step="0.05"
                          value={shapeMetadata[activeFormShapeId]?.height || shapeMetadata[activeFormShapeId]?.thickness || ""}
                          onChange={(e) => handleMetadataChange(activeFormShapeId, shapeMetadata[activeFormShapeId]?.Label === "ceilingObject" ? "height" : "thickness", e.target.value)}
                          className="bg-white/5 border-white/10 text-white rounded-xl"
                        />
                      </div>
                      {/* <div className="space-y-2">
                        <Label className="text-white/70 text-sm">Texture (Optional)</Label>
                        <Input
                          placeholder="e.g. textures/wood/oak"
                          value={shapeMetadata[activeFormShapeId]?.texture || ""}
                          onChange={(e) => handleMetadataChange(activeFormShapeId, "texture", e.target.value)}
                          className="bg-white/5 border-white/10 text-white rounded-xl"
                        />
                      </div> */}
                    </>
                  )}
                </div>
              </CardContent>
            </ScrollArea>

            <div className="p-6 border-t border-white/10 bg-white/5 backdrop-blur-md">
              <Button
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl h-11 shadow-lg shadow-emerald-500/20 transition-all border-none"
                onClick={() => setActiveFormShapeId(null)}
              >
                Done
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Config Popup */}
      <Dialog open={showConfigPopup} onOpenChange={setShowConfigPopup}>
        <DialogContent className="max-w-md sm:max-w-lg bg-slate-900 border-white/10 text-white shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white">3D Generation Parameters</DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="floor_thickness" className="text-white/80">Floor Thickness</Label>
                  <Input
                    id="floor_thickness"
                    type="number"
                    step="0.01"
                    value={formParams.floor_thickness}
                    onChange={(e) => setFormParams({ ...formParams, floor_thickness: e.target.value })}
                    className="bg-white/5 border-white/10 text-white rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wall_height" className="text-white/80">Wall Height</Label>
                  <Input
                    id="wall_height"
                    type="number"
                    step="0.1"
                    value={formParams.wall_height}
                    onChange={(e) => setFormParams({ ...formParams, wall_height: e.target.value })}
                    className="bg-white/5 border-white/10 text-white rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scale_factor" className="text-white/80">Scale Factor</Label>
                  <Input
                    id="scale_factor"
                    type="number"
                    step="0.01"
                    value={formParams.pixelsPerFoot}
                    onChange={(e) => setFormParams({ ...formParams, pixelsPerFoot: e.target.value })}
                    className="bg-white/5 border-white/10 text-white rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roof_thickness" className="text-white/80">Roof Thickness</Label>
                  <Input
                    id="roof_thickness"
                    type="number"
                    step="0.01"
                    value={formParams.roof_thickness}
                    onChange={(e) => setFormParams({ ...formParams, roof_thickness: e.target.value })}
                    className="bg-white/5 border-white/10 text-white rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lintel_height" className="text-white/80">Lintel Height</Label>
                  <Input
                    id="lintel_height"
                    type="number"
                    step="0.1"
                    value={formParams.lintel_height}
                    onChange={(e) => setFormParams({ ...formParams, lintel_height: e.target.value })}
                    className="bg-white/5 border-white/10 text-white rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sill_height" className="text-white/80">Sill Height</Label>
                  <Input
                    id="sill_height"
                    type="number"
                    step="0.1"
                    value={formParams.sill_height}
                    onChange={(e) => setFormParams({ ...formParams, sill_height: e.target.value })}
                    className="bg-white/5 border-white/10 text-white rounded-xl"
                  />
                </div>
              </div>

              {/* <div className="space-y-2">
                <Label htmlFor="texture_path" className="text-white/80">Texture Path (PBR Library URL)</Label>
                <Input
                  id="texture_path"
                  placeholder="e.g. /textures/wall_brick_01"
                  value={formParams.texture_path}
                  onChange={(e) => setFormParams({ ...formParams, texture_path: e.target.value })}
                  className="bg-white/5 border-white/10 text-white rounded-xl"
                />
              </div> */}

              {/* <div className="space-y-2">
                <Label htmlFor="door_path" className="text-white/80">Door GLB Path</Label>
                <Input
                  id="door_path"
                  placeholder="URL or server location"
                  value={formParams.door_path}
                  onChange={(e) => setFormParams({ ...formParams, door_path: e.target.value })}
                  className="bg-white/5 border-white/10 text-white rounded-xl"
                />
              </div> */}

              {/* <div className="space-y-2">
                <Label htmlFor="window_path" className="text-white/80">Window GLB Path</Label>
                <Input
                  id="window_path"
                  placeholder="URL or server location"
                  value={formParams.window_path}
                  onChange={(e) => setFormParams({ ...formParams, window_path: e.target.value })}
                  className="bg-white/5 border-white/10 text-white rounded-xl"
                />
              </div> */}

              {/* <div className="space-y-2">
                <Label htmlFor="library_path" className="text-white/80">Library Path (Blender Addon)</Label>
                <Input
                  id="library_path"
                  placeholder="C:\..."
                  value={formParams.library_path}
                  onChange={(e) => setFormParams({ ...formParams, library_path: e.target.value })}
                  className="bg-white/5 border-white/10 text-white rounded-xl"
                />
              </div> */}
            </div>
          </ScrollArea>

          <DialogFooter className="mt-6 flex justify-between items-center bg-transparent border-t border-white/10 pt-6">
            {/* <Button
              variant="outline"
              onClick={handleDownloadJSON}
              className="flex items-center gap-2 bg-white/5 border-white/10 text-white hover:bg-white/10 rounded-xl"
            >
              <Download className="h-4 w-4" />
              Download JSON
            </Button> */}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setShowConfigPopup(false)} className="text-white/60 hover:text-white hover:bg-white/10 rounded-xl">
                Cancel
              </Button>
              <Button
                onClick={handleFinalProceed}
                disabled={isExporting}
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl px-6 shadow-lg shadow-emerald-500/20 shadow-xl transition-all border-none"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate 3D Model"
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
