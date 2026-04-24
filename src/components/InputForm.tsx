import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Plus, X, Upload, Trash2, RefreshCw, Download } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { ImageExpandDialog } from "./ui/image-expand-dialog";
import { getServiceByEntity, uploadImageToS3, updateServiceByEntity, getDataSpecificById } from "@/api/action";
import html2canvas from "html2canvas";
import { Tabs } from "@radix-ui/react-tabs";
import { TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import ImageAnnotator from "./annotation";
import { Dialog, DialogContent } from "./ui/dialog";
import { toast } from "sonner";
import LoadingPopup from "./loadingpopup";
import Products from "./products";

const getRandomColor = () => {
  const letters = "0123456789ABCDEF";
  let color = "#";

  
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

// New lightweight version-based structure used by the annotation/righttoolbar flow.
// Kept optional so older section-based data (flooring/ceiling/walls/furniture) continues to work.
export interface RoomVersionInputs {
  materialImages: Array<{
    image: string;
    description: string;
  }>;
  referenceImages?: Array<{
    image: string;
    description: string;
  }>;
}

export interface RoomVersion {
  // All images associated with this version (plan, intermediate, etc.)
  images: string;
  mainimage?:string;
  inputIndex?:number;
  // Inputs (material / description / references) used to generate this version.
  inputs: RoomVersionInputs;
  annotation?:any;
  inputData?:any;
}

export interface RoomInputData {
  id?: string;
  roomName: string;
  area?: string;
  planImage?: string;
  layoutImage?: string;
  length?: string;
  breadth?: string;
  height?: string;
  windowType?: string;
  windowSize?: string;
  doorType?: string;
  doorSize?: string;
  layoutResultImage?: string;

  // New version-based data model for rooms.
  versions?: RoomVersion[];
  // Flat list of all generated result images across versions for quick horizontal scrolling.
  versionImage?: Array<{
    versionIndex?:any;
    image?:string;
  }>;

  // Legacy section-based fields kept for backward compatibility.
  flooring?: Array<{
    name?: string;
    area?: string;
    planImage: string;
    type: string;
    size: string;
    finish: string;
    color: string;
    pattern: string;
    edgeDetails: string;
    skirtingTypeHeight: string;
    materialImages: Array<{
      description: string;
      image: string;
    }>;
    referenceImages: Array<{
      description: string;
      image: string;
    }>;
    links: string[];
    resultImage?: string;
    htmlImage?: string;
    annotationColor?: string;
  }>;
  ceiling?: Array<{
    name?: string;
    area?: string;


    planImage: string;
    type: string;
    heightFromFFL: string;
    coveDetails: string;
    lightFixtures: string;
    patternOrShape: string;
    color: string;
    ceilingMaterials: Array<{
      description: string;
      image: string;
    }>;
    referenceImages: Array<{
      description: string;
      image: string;
    }>;
    links: string[];
    resultImage?: string;
    htmlImage?: string;
    annotationColor?: string;
  }>;
  walls?: Array<{
    name?: string;
    length?: string;

    wallName: string;
    planImage: string;
    material: string;
    colorCode: string;
    panelSizeOrArrangement: string;
    texture: string;
    specialFeatures: string;
    anyArtworkOrSignage: string;
    finishMaterialImages: string;
    referenceImages: Array<{
      image: string;
      description: string;
    }>;
    resultImage?: string;
    htmlImage?: string;
    annotationColor?: string;
  }>;
  furniture?: {
    planImage: string;
    dimensions: string;
    laminateColor: string;
    legColor: string;
    chairLinks: string[];
    tableDetails: Array<{
      name?: string;
      material: string;
      color: string;
      link: string;
    }>;

    referenceImage: any;
    resultImage?: string;
    htmlImage?: string;
    annotationColor?: string;
  };
}

interface InputFormProps {
  data: RoomInputData;
  onDataChange: (data: RoomInputData) => void;
  calculatedArea?: string;
  activeSection?: "layout" | "flooring" | "ceiling" | "walls" | "furniture" | null;
  tab?: "layout" | "flooring" | "ceiling" | "walls" | "furniture";
  setTab?: (tab: "layout" | "flooring" | "ceiling" | "walls" | "furniture") => void;
  selectedIndex?: number | null;
  setSelectedIndex?: (index: number | null) => void;
  formonly?: boolean;
  setActiveSection?: (section: "layout" | "flooring" | "ceiling" | "walls" | "furniture") => void;
  onRemoveItem?: (section: string, index: number) => void;
  handleExportLayout?: () => Promise<string>;
}

export function InputForm({ data, onDataChange, calculatedArea, activeSection, tab, setTab, selectedIndex, setSelectedIndex, formonly, setActiveSection, onRemoveItem, handleExportLayout }: InputFormProps) {
  const { id } = useParams();
  const [localData, setLocalData] = useState<RoomInputData>(data);
  const [editingFlooring, setEditingFlooring] = useState<number | null>(null);
  const [editingCeiling, setEditingCeiling] = useState<number | null>(null);
  const [editingWall, setEditingWall] = useState<number | null>(null);
  const [editingTable, setEditingTable] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);
  console.log("localData", localData)
  const [isEditingName, setIsEditingName] = useState(false);

  // State for annotation dialog
  const [isAnnotationOpen, setIsAnnotationOpen] = useState(false);
  const [annotationImageUrl, setAnnotationImageUrl] = useState<string>("");
  const [annotationImageIndex, setAnnotationImageIndex] = useState<number | null>(null);
  const [annotatedImageFile, setAnnotatedImageFile] = useState<File | null>(null);
  const [regeneratePrompt, setRegeneratePrompt] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [productss,setProductss]=useState(null)

  useEffect(() => {
    setLocalData(data);

  }, [data]);

  useEffect(()=> {
    const getentity=async()=>{
      const dattt=await getServiceByEntity("694e730907e8c30156c01789")
      console.log("fetched:",dattt)
      setProductss(dattt?.map(data => data.data))
    }
    if(productss === null){
    getentity()
    }

  },[productss])

        console.log("productss:",productss)


  useEffect(() => {
    if (activeSection) {
      setTab(activeSection);
    }
  }, [activeSection]);
  useEffect(() => {
    if (localData) {

      if (localData) {
        // if (localData?.layoutResultImage) {
        //   setResult(localData?.layoutResultImage);
        // }
        const newResult: string[] = [];

        if (localData?.flooring) {
          if (localData?.flooring?.[0]?.resultImage && !newResult.includes(localData?.flooring[0]?.resultImage)) {
            newResult.push(localData?.flooring[0]?.resultImage);
          }

        } else if (localData?.ceiling) {
          if (localData?.ceiling[0]?.resultImage && !newResult.includes(localData?.ceiling[0]?.resultImage)) {
            newResult.push(localData?.ceiling[0]?.resultImage);
          }

        }
        else if (localData?.walls) {
          if (localData?.walls[0]?.resultImage && !newResult.includes(localData?.walls[0]?.resultImage)) {
            newResult.push(localData?.walls[0]?.resultImage);
          }
        }
        else if (localData?.furniture && localData?.furniture.resultImage) {
          if (!newResult.includes(localData?.furniture.resultImage)) {
            newResult.push(localData?.furniture.resultImage);
          }
        }

      }

    }
  }, [localData]);

  console.log("Result Images:", result);

  // useEffect(() => {
  //   if (calculatedArea && !localData?.area) {
  //     updateField("area", calculatedArea);
  //   }
  // }, [calculatedArea]);

  const updateField = (path: string, value: any) => {
    const newData = JSON.parse(JSON.stringify(localData)); // Deep clone
    const keys = path.split(".");
    let current: any = newData;

    // Navigate to the parent of the target field
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key.includes("[")) {
        const [arrayKey, indexStr] = key.split("[");
        const index = parseInt(indexStr.replace("]", ""));
        console.log("aar:",arrayKey)
        if (!current[arrayKey]) current[arrayKey] = [];
        if (!current[arrayKey][index]) {
          if (arrayKey === "flooring") {
            current[arrayKey][index] = {
              planImage: "",
              type: "",
              size: "",
              finish: "",
              color: "",
              pattern: "",
              edgeDetails: "",
              skirtingTypeHeight: "",
              materialImages: [],
              referenceImages: [],
              links: [],
              annotationColor: "",
            };
          } else if (arrayKey === "ceiling") {
            current[arrayKey][index] = {
              planImage: "",
              type: "",
              heightFromFFL: "",
              coveDetails: "",
              lightFixtures: "",
              patternOrShape: "",
              color: "",
              ceilingMaterials: [],
              referenceImages: [],
              links: [],
            };
          } else if (arrayKey === "walls") {
            current[arrayKey][index] = {
              wallName: "",
              planImage: "",
              material: "",
              colorCode: "",
              panelSizeOrArrangement: "",
              texture: "",
              specialFeatures: "",
              anyArtworkOrSignage: "",
              finishMaterialImages: "",
              referenceImages: [],
            };
          } else if (arrayKey === "tableDetails") {
            current[arrayKey][index] = { material: "", color: "", link: "" };
          } else if (arrayKey === "materialImages" || arrayKey === "referenceImages" ||   arrayKey === "referenceImage" || // ✅ ADD THIS
arrayKey === "ceilingMaterials") {
            current[arrayKey][index] = { description: "", image: "" };
          }
        }
        current = current[arrayKey][index];
      } else {
        if (!current[key]) {
          if (key === "furniture") {
            current[key] = {
              planImage: "",
              dimensions: "",
              laminateColor: "",
              legColor: "",
              chairLinks: [],
              tableDetails: [],
              referenceImage: [],
              annotationColor: "",
            };
          } else {
            current[key] = {};
          }
        }
        current = current[key];
      }
    }

    // Set the value
    const lastKey = keys[keys.length - 1];
    if (lastKey.includes("[")) {
      const [arrayKey, indexStr] = lastKey.split("[");
      const index = parseInt(indexStr.replace("]", ""));
      if (!current[arrayKey]) current[arrayKey] = [];
      current[arrayKey][index] = value;
    } else {
      current[lastKey] = value;
    }

    setLocalData(newData);
    onDataChange(newData);
  };



  // Helper function to convert base64 string to File
  const base64ToFile = (base64String: string, filename: string = "image.png"): File | null => {
    try {
      // Check if it's a data URL
      const base64Data = base64String.includes(",")
        ? base64String.split(",")[1]
        : base64String;

      // Convert base64 to binary
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "image/png" });

      return new File([blob], filename, { type: "image/png" });
    } catch (error) {
      console.error("Error converting base64 to File:", error);
      return null;
    }
  };

  // Helper function to check if a string is a base64 image
  const isBase64Image = (str: string): boolean => {
    if (!str || typeof str !== "string") return false;
    // Check if it's a data URL or base64 string
    return str.startsWith("data:image/") || /^[A-Za-z0-9+/=]+$/.test(str.replace(/\s/g, ""));
  };

  // Helper function to check if a string is a URL
  const isUrl = (str: string): boolean => {
    if (!str || typeof str !== "string") return false;
    return str.startsWith("http://") || str.startsWith("https://");
  };

  // Process and upload a single image value (base64, URL, or already uploaded)
  const processImageValue = async (value: string): Promise<string> => {
    if (!value || value === "") return "";

    // If it's already a URL, return it
    if (isUrl(value)) {
      return value;
    }

    // If it's base64, convert and upload
    if (isBase64Image(value)) {
      const file = base64ToFile(value);
      if (file) {
        const uploadedUrl = await uploadImageToS3(file);
        return uploadedUrl || "";
      }
    }

    return value;
  };
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [showLoader, setShowLoader] = useState(false);
 type Mode = "options" | "browse" | "product";

const [materialMode, setMaterialMode] = useState<{
  [floorIndex: number]: Mode[];
}>({});

console.log("materialMode:",materialMode)


const getMaterialMode = (floorIndex: number, imgIndex: number): Mode =>
  materialMode[floorIndex]?.[imgIndex] ?? "options";


  useEffect(() => {
    if (!showLoader) return;
    if (loadingPercent < 90) {
      let value = 5;
      setLoadingPercent(value);

      const interval = setInterval(() => {
        if (value < 90) {
          value += 10;
          setLoadingPercent(value);
        } else {
          clearInterval(interval); // stop at 90%
        }
      }, 2000); // 5 seconds

      return () => clearInterval(interval);
    }
  }, [showLoader]);


  // Transform data structure for API
  const transformDataForAPI = async (sectionData: any, sectionType: string | null): Promise<any> => {
    if (!sectionType || !sectionData) {
      return null;
    }

    // Process planImage for the active section
    let planImageUrl = "";
    if (sectionType === "flooring" || sectionType === "ceiling" || sectionType === "walls") {
      // For array sections, we'll get planImage from the first item or handle it differently
      if (Array.isArray(sectionData) && sectionData.length > 0) {
        if (sectionData[0]?.planImage === "") {
          await handleExportLayout();

        }
        // Get planImage from first item if available, or use localData?.planImage
        planImageUrl = await processImageValue(sectionData[0]?.planImage || localData?.planImage || "");
      }
    } else if (sectionType === "furniture") {
      if (sectionData.planImage === "") {
        await handleExportLayout();

      }
      planImageUrl = await processImageValue(sectionData.planImage || localData?.planImage || "");
    } else {
      planImageUrl = await processImageValue(localData?.planImage || "");
    }

    // Transform based on section type
    if (sectionType === "flooring" && Array.isArray(sectionData)) {
      const dataa = await Promise.all(
        sectionData?.map(async (item: any) => {
          // Process all images in the item
          const processedItem: any = { ...item };

          // Process planImage
          if (item.planImage) {
            processedItem.planImage = await processImageValue(item.planImage);
          }

          // Process materialImages
          const Materials = await Promise.all(
            (item.materialImages || [])?.map(async (mat: any) => ({
              description: mat.description || "",
              image: await processImageValue(mat.image || ""),
            }))
          );

          // Process referenceImages
          const processedReferenceImages = await Promise.all(
            (item.referenceImages || [])?.map(async (ref: any) => ({
              description: ref.description || "",
              image: await processImageValue(ref.image || ""),
            }))
          );
          const { materialImages,annotationColor, ...rest } = processedItem;

          return {
            ...rest,
            Materials,
            referenceImages: processedReferenceImages,
          };
        })
      );

      return {
        planImage: planImageUrl,
        dataa,
      };
    }

    if (sectionType === "ceiling" && Array.isArray(sectionData)) {
      const dataa = await Promise.all(
        sectionData?.map(async (item: any) => {
          const processedItem: any = { ...item };

          if (item.planImage) {
            processedItem.planImage = await processImageValue(item.planImage);
          }

          // Process ceilingMaterials as Materials
          const Materials = await Promise.all(
            (item.ceilingMaterials || [])?.map(async (mat: any) => ({
              description: mat.description || "",
              image: await processImageValue(mat.image || ""),
            }))
          );

          const processedReferenceImages = await Promise.all(
            (item.referenceImages || [])?.map(async (ref: any) => ({
              description: ref.description || "",
              image: await processImageValue(ref.image || ""),
            }))
          );
          const { ceilingMaterials,annotationColor, ...rest } = processedItem;

          return {
            ...rest,
            Materials,
            referenceImages: processedReferenceImages,
          };
        })
      );

      return {
        planImage: planImageUrl,
        dataa,
      };
    }

    if (sectionType === "walls" && Array.isArray(sectionData)) {
      const dataa = await Promise.all(
        sectionData?.map(async (item: any) => {
          const processedItem: any = { ...item };

          if (item.planImage) {
            processedItem.planImage = await processImageValue(item.planImage);
          }

          // Process finishMaterialImages - convert string to Materials array
          const Materials = [];
          if (item.finishMaterialImages) {
            const imageUrl = await processImageValue(item.finishMaterialImages);
            if (imageUrl) {
              Materials.push({
                description: "",
                image: imageUrl,
              });
            }
          }

          const processedReferenceImages = await Promise.all(
            (item.referenceImages || [])?.map(async (ref: any) => ({
              description: ref.description || "",
              image: await processImageValue(ref.image || ""),
            }))
          );
          const { finishMaterialImages,annotationColor, ...rest } = processedItem;

          return {
            ...rest,
            Materials,
            referenceImages: processedReferenceImages,
          };
        })
      );

      return {
        planImage: planImageUrl,
        dataa,
      };
    }

    if (sectionType === "furniture") {
      const processedItem: any = { ...sectionData };

      if (sectionData.planImage) {
        processedItem.planImage = await processImageValue(sectionData.planImage);
      }

      // Process referenceImage array as Materials
     const Materials = await Promise.all([
  ...(sectionData.referenceImage || []).map(async (img) => ({
    description: img.description,
    image: await processImageValue(img.image),
  })),

  ...(sectionData.chairLinks || []).map(async (img) => ({
    description: "",
    image: await processImageValue(img),
  })),
  ...(sectionData.tableDetails || []).map(async (img) => ({
    description: `${img.material},` + `${img.color}`,
    image: await processImageValue(img.link),
  })),
]);


      return {
        planImage: planImageUrl,
        dataa: [
          {
            ...processedItem,
            Materials,
          },
        ],
      };
    }

    return null;
  };
  const API_URL = import.meta.env.VITE_API_URL;

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role") || "customer";

    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-user-type": "customer",
    };
  };


  // Handle regenerate button click
  const handleRegenerate = (imageUrl: string, index?: number) => {

    setAnnotationImageUrl(imageUrl);
    setAnnotationImageIndex(index);
    setIsAnnotationOpen(true);
    setRegeneratePrompt("");
    setAnnotatedImageFile(null);
  };

  // Handle annotation save
  const handleAnnotationSave = async (
    annotations: any[],
    annotatedImage?: File,
    uploadedFile?: File,
    unitType?: string,
    scaleMeasurement?: string,
    pixelPerFeet?: number | null
  ) => {
    if (annotatedImage) {
      setAnnotatedImageFile(annotatedImage);
      console.log("annotatedImage", annotatedImage)

    }
  };

  // Handle proceed button click - send annotated image and prompt to API
  const handleProceed = async () => {
    if (!annotatedImageFile && !annotationImageUrl) {
      console.warn("No annotated image available");
      return;
    }

    setIsProcessing(true);
    try {
      let imageUrl = annotationImageUrl;

      // If we have an annotated image file, upload it first
      if (annotatedImageFile) {
        imageUrl = await uploadImageToS3(annotatedImageFile);
      }

      const headers = getAuthHeaders();

      // Send annotated image and prompt to API
      // You may need to adjust the API endpoint based on your requirements
      const res = await fetch(`${API_URL}/api/user/agent/start/6943a8231bedc936c4332e1f`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          image: imageUrl,
          query: regeneratePrompt || "",
          // Indicate this is a regeneration request
        }),
      });

      const result = await res.json();
      const imageDataUrl = result?.workflowlog?.tasks?.[result?.workflowlog?.tasks?.length - 1]?.result?.data[0];
      if (imageDataUrl && activeSection === "layout") {
        const newData = JSON.parse(JSON.stringify(localData));
        newData.layoutResultImage = imageDataUrl;
        newData.planImage=imageDataUrl;
        console.log("newData", newData.layoutResultImage)
        setLocalData(newData);
        onDataChange(newData);

      }

      if (imageDataUrl && annotationImageIndex !== null && activeSection === "flooring") {
        setResult(imageDataUrl)
        // Update the result image in localData
        const newData = JSON.parse(JSON.stringify(localData));
        if (newData.flooring[annotationImageIndex]) {
          newData.flooring[annotationImageIndex].resultImage = imageDataUrl;
          setLocalData(newData);
          onDataChange(newData);
        }
      }
      if (imageDataUrl && annotationImageIndex !== null && activeSection === "ceiling") {
        setResult(imageDataUrl)
        // Update the result image in localData
        const newData = JSON.parse(JSON.stringify(localData));
        if (newData.ceiling[annotationImageIndex]) {
          newData.ceiling[annotationImageIndex].resultImage = imageDataUrl;
          setLocalData(newData);
          onDataChange(newData);
        }
      }
      if (imageDataUrl && annotationImageIndex !== null && activeSection === "walls") {
        setResult(imageDataUrl)
        // Update the result image in localData
        const newData = JSON.parse(JSON.stringify(localData));
        if (newData.walls[annotationImageIndex]) {
          newData.walls[annotationImageIndex].resultImage = imageDataUrl;
          setLocalData(newData);
          onDataChange(newData);
        }
      }
      if (imageDataUrl && activeSection === "furniture") {
        setResult(imageDataUrl)
        // Update the result image in localData
        const newData = JSON.parse(JSON.stringify(localData));
        if (newData.furniture) {
          newData.furniture.resultImage = imageDataUrl;
          setLocalData(newData);
          onDataChange(newData);
        }
      }

      // Close dialog
      setIsAnnotationOpen(false);
      setAnnotationImageUrl("");
      setAnnotationImageIndex(null);
      setAnnotatedImageFile(null);
      setRegeneratePrompt("");
    } catch (error) {
      console.error("Error processing regeneration:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const convertHtmlToImage = async (htmlString: string): Promise<Blob> => {
    let tempDiv: HTMLDivElement | null = null;

    try {
      const A4_WIDTH = 794;   // px
      const A4_HEIGHT = 1123; // px
      const A4_PADDING = 32;

      tempDiv = document.createElement("div");
      tempDiv.style.position = "absolute";
      tempDiv.style.left = "-99999px"; // hide off-screen
      tempDiv.style.top = "0";
      tempDiv.style.width = `${A4_WIDTH}px`;
      tempDiv.style.minHeight = `${A4_HEIGHT}px`;
      tempDiv.style.padding = `${A4_PADDING}px`;
      tempDiv.style.backgroundColor = "#ffffff";
      tempDiv.style.boxSizing = "border-box";
      tempDiv.style.fontFamily = "Arial, sans-serif";

      tempDiv.innerHTML = htmlString;
      document.body.appendChild(tempDiv);

      // 🔁 Force layout
      tempDiv.getBoundingClientRect();

      // ✅ Wait for all images (base64 + normal)
      const images = tempDiv.querySelectorAll("img");
      await Promise.all(
        Array.from(images)?.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete && img.naturalWidth > 0) return resolve();
              img.onload = () => resolve();
              img.onerror = () => resolve();
            })
        )
      );

      // ⏳ Let browser paint
      await new Promise((r) => setTimeout(r, 300));

      const canvas = await html2canvas(tempDiv, {
        backgroundColor: "#ffffff",
        scale: 2, // high quality
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: A4_WIDTH,
        height: tempDiv.scrollHeight, // ✅ IMPORTANT
        windowWidth: A4_WIDTH,
        windowHeight: tempDiv.scrollHeight,
      });
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (!b) reject(new Error("Canvas toBlob failed"));
          else resolve(b);
        }, "image/png");
      });

      return blob;
    } catch (err) {
      console.error("HTML → Image failed:", err);
      if (tempDiv?.parentNode) document.body.removeChild(tempDiv);
      throw err;
    }
  };


  const [load, setLoad] = useState(false)


  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(localData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${localData.roomName || 'room_data'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (sectionOverride?: "layout" | "flooring" | "ceiling" | "walls" | "furniture") => {
    console.log("handleSubmit");

    const currentSection = sectionOverride || activeSection;
     
    if (!currentSection) {
      console.warn("No active section selected");
      return;
    }
// console.log("localData[currentSection]",localData[currentSection].planImage)
    // const add=await handleExportLayout();
    const isFurniture = currentSection === "furniture";
    const isLayout = currentSection === "layout";

    let isImageMissing = false;

    if (isFurniture) {
      isImageMissing =
        !localData.furniture?.planImage ||
        localData.furniture.planImage.trim() === "";
    }
    else if (isLayout) {
      isImageMissing =
        !localData.layoutImage ||
        localData.layoutImage.trim() === "";
    }
    else {
      isImageMissing =
        !localData[currentSection]?.[0]?.planImage ||
        localData[currentSection]?.[0]?.planImage.trim() === "";
    }

    if (isImageMissing) {
      toast.error("Save the image and Continue");
      return;
    }


    if (currentSection === "layout") {
      await handleSubmitLayout();
      return;
    }

    try {
      setShowLoader(true);

      setLoad(true)
      console.log("Processing and uploading files...");

      // Transform the data structure
      let sectionData = null;
      
        sectionData = localData[currentSection];
      

      const transformedData = await transformDataForAPI(
        sectionData,
        currentSection
      );

      // Prepare updated room data with original keys but S3 URLs
      let updatedRoom = { ...localData };
      if (transformedData && transformedData.dataa) {
        updatedRoom.planImage = transformedData.planImage || updatedRoom.planImage;
        if (currentSection === "flooring") {
          updatedRoom.flooring = localData.flooring.map((f, i) => ({
            ...f,
            planImage: transformedData.dataa[i]?.planImage || f.planImage,
            materialImages: transformedData.dataa[i]?.Materials || f.materialImages,
            referenceImages: transformedData.dataa[i]?.referenceImages || f.referenceImages
          }));
        } else if (currentSection === "ceiling") {
          updatedRoom.ceiling = localData.ceiling.map((c, i) => ({
            ...c,
            planImage: transformedData.dataa[i]?.planImage || c.planImage,
            ceilingMaterials: transformedData.dataa[i]?.Materials || c.ceilingMaterials,
            referenceImages: transformedData.dataa[i]?.referenceImages || c.referenceImages
          }));
        } else if (currentSection === "walls") {
          updatedRoom.walls = localData.walls.map((w, i) => ({
            ...w,
            planImage: transformedData.dataa[i]?.planImage || w.planImage,
            finishMaterialImages: transformedData.dataa[i]?.Materials?.[0]?.image || w.finishMaterialImages,
            referenceImages: transformedData.dataa[i]?.referenceImages || w.referenceImages
          }));
        } else if (currentSection === "furniture") {
          const item = transformedData.dataa[0];
          const refCount = localData.furniture?.referenceImage?.length || 0;
          const chairCount = localData.furniture?.chairLinks?.length || 0;

          updatedRoom.furniture = {
            ...localData.furniture,
            planImage: item.planImage,
            referenceImage: item.Materials.slice(0, refCount),
            chairLinks: item.Materials.slice(refCount, refCount + chairCount).map((m: any) => m.image),
            tableDetails: localData.furniture.tableDetails.map((td, idx) => ({
              ...td,
              link: item.Materials[refCount + chairCount + idx]?.image || td.link
            }))
          };
        }
      }

      // Update local state and parent
      setLocalData(updatedRoom);
      onDataChange(updatedRoom);

      // Save to backend
      if (id) {
        try {
          const response = await getDataSpecificById("69d0b54cad8abad1ca92d84b", id);
          if (response.success && response.data?.rooms) {
            const updatedRooms = response.data.rooms.map((r: any) =>
              r.roomName === updatedRoom.roomName ? updatedRoom : r
            );
            await updateServiceByEntity("69d0b54cad8abad1ca92d84b", id, { rooms: updatedRooms });
            console.log("Backend updated successfully");
          }
        } catch (err) {
          console.error("Failed to update backend:", err);
        }
      }


      const payload={
        ...updatedRoom,
       [currentSection]:transformedData

      }



      const newData = JSON.parse(JSON.stringify(updatedRoom)); // Deep clone

      const formattedOutput = Object.entries(transformedData)
        ?.map(([key, value]) => `${key}-${value ?? ""}`)
        .join(",");

      if (!transformedData) {
        console.error("Failed to transform data");
        return;
      }
      const headers = getAuthHeaders()
      let agentId = "693d5b2c1bedc936c432bc83"
      if(currentSection === "furniture"){
        agentId = "694feb7b07e8c30156c0602c"

      }
      
      const res = await fetch(`${API_URL}/api/user/agent/start/693d5b2c1bedc936c432bc83`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(transformedData),
      });
      const ress = await res.json();
      const htmlData = ress?.workflowlog?.tasks?.[0]?.result?.data;
      console.log("htmlData",htmlData)

      // Convert HTML to image
      if (htmlData && typeof htmlData === "string" && htmlData.trim().length > 0) {
        console.log("Converting HTML to image...");
        try {
          const imageData = await convertHtmlToImage(htmlData);
          const s3Url = await uploadImageToS3(imageData);
          if (currentSection === "furniture") {
            newData.furniture.htmlImage = s3Url;
          } else if (currentSection === "flooring" && Array.isArray(newData.flooring) && newData.flooring.length > 0) {
            // Save to first item in array
            newData.flooring[0].htmlImage = s3Url;
          } else if (currentSection === "ceiling" && Array.isArray(newData.ceiling) && newData.ceiling.length > 0) {
            // Save to first item in array
            newData.ceiling[0].htmlImage = s3Url;
          } else if (currentSection === "walls" && Array.isArray(newData.walls) && newData.walls.length > 0) {
            // Save to first item in array
            newData.walls[0].htmlImage = s3Url;
          }

          const headers = getAuthHeaders()
          let mainImage = ""
          console.log("result", result)
          let ress_image = result
          if (activeSection === "flooring") {
            ress_image = updatedRoom?.layoutResultImage

          }
          else if (activeSection === "ceiling") {
            ress_image = updatedRoom?.flooring?.[0]?.resultImage

          }
          else if (activeSection === "walls") {
            ress_image = updatedRoom?.ceiling?.[0]?.resultImage

          }
          else if (activeSection === "furniture") {
            ress_image = updatedRoom?.walls?.[0]?.resultImage

          }
          else {
            ress_image = result
          }
          if (ress_image) {
            mainImage = `Below is the base image,generate the image in this image as a main image ${ress_image},don't add any background or any other elements which is not mentained in the provided image`
          }



          let ratio = "";
          if (updatedRoom?.planImage) {
            try {
              const getImageDimensions = (src: string): Promise<{ width: number; height: number }> => {
                return new Promise((resolve, reject) => {
                  const img = new Image();
                  img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
                  img.onerror = reject;
                  img.src = src;
                });
              };
              const dims = await getImageDimensions(updatedRoom.planImage);
              ratio = `${dims.width}x${dims.height}`;
            } catch (error) {
              console.error("Error getting image dimensions:", error);
            }
          }

          const res = await fetch(`${API_URL}/api/user/agent/start/693c07d61bedc936c432a9e5`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: JSON.stringify({ image: s3Url, query: transformedData.dataa, mainimage: mainImage, result: ress_image, ratio: ratio }),
          });
          const resu = await res.json();
          if (resu?.workflowlog?.tasks?.[1]?.result?.data[0]) {
            setLoadingPercent(100);

            const imageDataUrl = resu?.workflowlog?.tasks?.[2]?.result?.data[0];
            setResult(imageDataUrl)
            // Save the image to localData based on section type

            if (currentSection === "furniture") {
              newData.furniture.resultImage = imageDataUrl;
            } else if (currentSection === "flooring" && Array.isArray(newData.flooring) && newData.flooring.length > 0) {
              // Save to first item in array
              newData.flooring[0].resultImage = imageDataUrl;
            } else if (currentSection === "ceiling" && Array.isArray(newData.ceiling) && newData.ceiling.length > 0) {
              // Save to first item in array
              newData.ceiling[0].resultImage = imageDataUrl;
            } else if (currentSection === "walls" && Array.isArray(newData.walls) && newData.walls.length > 0) {
              // Save to first item in array
              newData.walls[0].resultImage = imageDataUrl;
            }

            setLocalData(newData);
            onDataChange(newData);
            console.log("Result image saved to localData");

            // Save final result to backend
            if (id) {
              try {
                const response = await getDataSpecificById("69d0b54cad8abad1ca92d84b", id);
                if (response.success && response.data?.rooms) {
                  const updatedRooms = response.data.rooms.map((r: any) =>
                    r.roomName === newData.roomName ? newData : r
                  );
                  await updateServiceByEntity("69d0b54cad8abad1ca92d84b", id, { rooms: updatedRooms });
                  console.log("Backend updated with final result image");
                }
              } catch (err) {
                console.error("Failed to update backend with final result image:", err);
              }
            }
          }
        } catch (conversionError) {
          toast.error("Image generation failed! please try again");
          console.error("Failed to convert HTML to image:", conversionError);
        }
      } else {
        toast.error("Image generation failed! please try again");
        console.warn("No valid HTML data found in response");
      }

      const jsonData = JSON.stringify(transformedData, null, 2);
      console.log("Transformed JSON:", jsonData);

      // Copy to clipboard
      //   navigator.clipboard.writeText(jsonData).then(() => {
      //     console.log("Data copied to clipboard");
      //   });
    } catch (error) {
      toast.error("Image generation failed! please try again");
      console.error("Error processing submit:", error);
    } finally {
      setLoad(false)
      setShowLoader(false);
      setLoadingPercent(0);

    }
  };

const getMode = (key: string): Mode => materialMode[key] ?? "options";

  const handleSubmitLayout = async () => {
    if (!localData?.length || !localData?.breadth) {
      toast.error("Please enter length and breadth");
      return;
    }

    try {
      setShowLoader(true);
      console.log("Processing layout generation...");

      // Construct payload
      const payload = {
        length: localData?.length,
        breadth: localData?.breadth,
        height: localData?.height,
        windowType: localData?.windowType,
        windowSize: localData?.windowSize,
        doorType: localData?.doorType,
        doorSize: localData?.doorSize
      };
      const pay = `Room Dimensions: L:${localData?.length} x B:${localData?.breadth} x H:${localData?.height}
      Window Type: ${localData?.windowType}
      Window Size: ${localData?.windowSize}
      Door Type: ${localData?.doorType}
      Door Size: ${localData?.doorSize}`;
      if (localData?.layoutImage === "") {
        await handleExportLayout();
      }
      const image = await processImageValue(localData?.layoutImage)
      console.log("image", image)

      const headers = getAuthHeaders();
      // Using a placeholder endpoint - verified from previous context or plan
      // NOTE: User didn't specify ID, using one similar to others or the one mentioned in plan
      const res = await fetch(`${API_URL}/api/user/agent/start/694b8bde07e8c30156bf5fb3`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          query: pay,
          image: image || "" // If plan image exists, send it too
        }),
      });

      const layoutResult = await res.json();

      // Assuming the response structure matches other workflows
      const imageDataUrl = layoutResult?.workflowlog?.tasks?.[layoutResult?.workflowlog?.tasks?.length - 1]?.result?.data[0];
      if (imageDataUrl) {
        setLoadingPercent(100);

        setResult(imageDataUrl)
        const newData = {
          ...localData,
          layoutResultImage: imageDataUrl,
          planImage: imageDataUrl,

          flooring: localData?.flooring?.length
            ? [{ ...localData?.flooring[0], planImage: "" }]
            : localData?.flooring,

          ceiling: localData?.ceiling?.length
            ? [{ ...localData?.ceiling[0], planImage: "" }]
            : localData?.ceiling,

          walls: localData?.walls?.length
            ? [{ ...localData?.walls[0], planImage: "" }]
            : localData?.walls,

          furniture: localData?.furniture
            ? { ...localData?.furniture, planImage: "" }
            : localData?.furniture,
        };

        setLocalData(newData);
        onDataChange(newData);

        // Save to backend
        if (id) {
          try {
            const response = await getDataSpecificById("69d0b54cad8abad1ca92d84b", id);
            if (response.success && response.data?.rooms) {
              const updatedRooms = response.data.rooms.map((r: any) =>
                r.roomName === newData.roomName ? newData : r
              );
              await updateServiceByEntity("69d0b54cad8abad1ca92d84b", id, { rooms: updatedRooms });
              console.log("Backend updated successfully (layout)");
            }
          } catch (err) {
            console.error("Failed to update backend (layout):", err);
          }
        }

        toast.success("Layout generated successfully!");
        // Auto-proceed to next tab if desired, or just show result
        // setTab("flooring"); 
      } else {
        toast.error("Failed to generate layout image");
      }

    } catch (error) {
      console.error("Error generating layout:", error);
      toast.error("Error generating layout");
    } finally {
      setShowLoader(false);
      setLoadingPercent(0);
    }
  };

  const handleFileUpload = async (path: string, file: File) => {
    // Convert file to base64 or handle upload
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      updateField(path, base64String);
    };
    reader.readAsDataURL(file);
  };

  const addArrayItem = (arrayPath: string) => {
    const newData = JSON.parse(JSON.stringify(localData)); // Deep clone
    const keys = arrayPath.split(".");
    let current: any = newData;

    // Navigate to the parent of the array
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key.includes("[")) {
        const [arrayKey, indexStr] = key.split("[");
        const index = parseInt(indexStr.replace("]", ""));
        current = current[arrayKey][index];
      } else {
        current = current[key];
      }
    }

    const lastKey = keys[keys.length - 1];
    if (!current[lastKey]) current[lastKey] = [];

    if (lastKey === "flooring") {
      current[lastKey].push({
        name: "Flooring " + (current[lastKey].length + 1),
        planImage: "",
        type: "",
        size: "",
        finish: "",
        color: "",
        pattern: "",
        edgeDetails: "",
        skirtingTypeHeight: "",
        materialImages: [],
        referenceImages: [],
        resultImage: "",
        htmlImage: "",
        annotationColor: getRandomColor(),
      });
    } else if (lastKey === "ceiling") {
      current[lastKey].push({
        name: "Ceiling " + (current[lastKey].length + 1),
        planImage: "",
        type: "",
        heightFromFFL: "",
        coveDetails: "",
        lightFixtures: "",
        patternOrShape: "",
        color: "",
        ceilingMaterials: [],
        referenceImages: [],
        links: [],
        annotationColor: getRandomColor(),
      });
    } else if (lastKey === "walls") {
      current[lastKey].push({
        name: "Wall " + (current[lastKey].length + 1),
        wallName: "",
        planImage: "",
        material: "",
        colorCode: "",
        panelSizeOrArrangement: "",
        texture: "",
        specialFeatures: "",
        anyArtworkOrSignage: "",
        finishMaterialImages: "",
        referenceImages: [],
        annotationColor: getRandomColor(),
      });
    } else if (lastKey === "tableDetails") {
      current[lastKey].push({ material: "", color: "", link: "" });
    } else if (lastKey === "materialImages" || lastKey === "referenceImages" || lastKey === "ceilingMaterials") {
      current[lastKey].push({ description: "", image: "" });
    } else if (lastKey === "links" || lastKey === "chairLinks" || lastKey === "referenceImage") {
      current[lastKey].push("");
    }

    setLocalData(newData);
    onDataChange(newData);
  };

  // Assuming InputFormProps interface is defined elsewhere, adding onRemoveItem to it.
  // For the purpose of this edit, we'll add a placeholder type definition if not found.
  // If InputFormProps is already defined, this would be merged.
  interface InputFormProps {
    onRemoveItem?: (section: string, index: number) => void;
    // ... other existing properties of InputFormProps
  }

  const removeArrayItem = (arrayPath: string, index: number) => {
    // Notify parent about deletion if it's a main section item
    if (onRemoveItem && (arrayPath === "flooring" || arrayPath === "ceiling" || arrayPath === "walls")) {
      onRemoveItem(arrayPath, index);
    }
    const newData = JSON.parse(JSON.stringify(localData)); // Deep clone
    const keys = arrayPath.split(".");
    let current: any = newData;

    // Navigate to the parent of the array
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key.includes("[")) {
        const [arrayKey, indexStr] = key.split("[");
        const arrIndex = parseInt(indexStr.replace("]", ""));
        current = current[arrayKey][arrIndex];
      } else {
        current = current[key];
      }
    }

    const lastKey = keys[keys.length - 1];
    current[lastKey].splice(index, 1);

    setLocalData(newData);
    onDataChange(newData);
  };

  const FileUploadField = ({ path, label, value }: { path: string; label: string; value?: string }) => {
    const getNestedValue = (obj: any, path: string): string => {
      const keys = path.split(".");
      let current: any = obj;
      for (const key of keys) {
        if (key.includes("[")) {
          const [arrayKey, indexStr] = key.split("[");
          const index = parseInt(indexStr.replace("]", ""));
          current = current[arrayKey]?.[index];
        } else {
          current = current?.[key];
        }
        if (current === undefined) return "";
      }
      return current || "";
    };

    const currentValue = value !== undefined ? value : getNestedValue(localData, path);

    return (
      <div className="space-y-2">
        <Label>{label === "planImage" ? "Annotated Image" : label}</Label>
        <div className=" relative flex items-center gap-2">
          <Input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(path, file);
            }}
            className="flex-1"
          />

          {currentValue && currentValue !== "" && (
            <>
              <img
                src={currentValue}
                alt="Preview"
                className="w-32 h-20 object-cover rounded-lg border"
              />
              <ImageExpandDialog imageUrl={currentValue} /></>

          )}
        </div>
      </div>
    );
  };
  // console.log("localData", localData?.layoutResultImage)

  return (
    <ScrollArea className={`h-full px-4 max-w-full  `}>


      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as any)}
        className="w-full"
      >
        {!formonly && (
          <>
            <div className={`${!formonly ? "border-b" : ""} py-3 mb-4`}>
              {!isEditingName ? (
                <div className="flex justify-between gap-4">
                  <h2
                    className="text-lg font-semibold cursor-pointer"
                    onClick={() => setIsEditingName(true)}
                  >
                    {localData?.roomName || "Unnamed Room"}
                    {localData?.area && ` (${localData?.area})`}
                  </h2>
                

                  {localData?.planImage && (
                    <div className="relative">
                      <img
                        src={localData?.planImage}
                        alt="Room plan"
                        className="w-10 h-10 rounded border object-cover"
                      />
                      <ImageExpandDialog imageUrl={localData?.planImage} triggerClassName="absolute bottom-0 right-0 w-4 h-4" additionalImages={[result]} />

                    </div>
                  )}
                  {result !== null && (<div className="relative">
                    <img
                      src={result }
                      alt="Room plan"
                      className="w-10 h-10 rounded border object-cover"
                    />
                    <ImageExpandDialog imageUrl={result} triggerClassName="absolute bottom-0 right-0 w-4 h-4" additionalImages={[localData?.planImage]} />

                  </div>)}


                  {!formonly && (
                    <>
                      {((tab === "layout" && localData?.layoutResultImage) ||
                        (tab === "flooring" && localData?.flooring?.[0]?.resultImage) ||
                        (tab === "ceiling" && localData?.ceiling?.[0]?.resultImage) ||
                        (tab === "walls" && localData?.walls?.[0]?.resultImage)) ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={async () => {
                            let nextSection: "layout" | "flooring" | "ceiling" | "walls" | "furniture" | undefined;

                            if (tab === "layout") {
                              nextSection = "flooring"
                            }
                            else if (tab === "flooring") nextSection = "ceiling";
                            else if (tab === "ceiling") nextSection = "walls";
                            else if (tab === "walls") nextSection = "furniture";

                            if (nextSection) {
                              setTab?.(nextSection);
                              // setActiveSection?.(nextSection);
                              // if (tab !== "layout") {
                              //   handleSubmit(nextSection);
                              // }
                            }
                          }}
                        >
                          {"Proceed to Next"}
                        </Button>
                      ) : null}
                  
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleSubmit()}
                          disabled={
                            load
                          }
                        >
                          
                        {
                          (activeSection === "layout" || activeSection === "furniture"
                            ? localData?.layoutResultImage || localData?.furniture?.resultImage
                            : localData?.[activeSection as any]?.[0]?.resultImage)
                            ? "Re-Generate"
                            : "Generate"
                        }
                        </Button></>
                  )}

                </div>
              ) : (
                <Input
                  autoFocus
                  value={localData?.roomName}
                  onChange={(e) => updateField("roomName", e.target.value)}
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setIsEditingName(false);
                  }}
                  placeholder="Enter room name"
                  className="max-w-xs"
                />
              )}
            </div>

            <TabsList className="grid grid-cols-4 w-full mb-4">
              {/* <TabsTrigger value="layout">Layout</TabsTrigger> */}
              <TabsTrigger value="flooring">Flooring</TabsTrigger>
              <TabsTrigger value="ceiling">Ceiling</TabsTrigger>
              <TabsTrigger value="walls">Walls</TabsTrigger>
              <TabsTrigger value="furniture">Furniture</TabsTrigger>
            </TabsList></>)}

        {/* BASIC DETAILS */}
        {/* Room Name */}

        {/* Plan Image */}
        {/* <FileUploadField path="planImage" label="Plan Image (Full Annotated Image) *" value={localData?.planImage} />    */}

        <TabsContent value="layout">
          {localData?.layoutResultImage && (
            <div className="space-y-2 border-t pt-4">
              <Label>Generated Layout</Label>
              <div className="relative flex justify-center">
                <img
                  src={localData?.layoutResultImage}
                  alt="Layout Result"
                  className="relative max-w-[300px] rounded-lg border object-contain"
                />
                <ImageExpandDialog imageUrl={localData?.layoutResultImage} additionalImages={[localData?.planImage]} />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"

                  onClick={() => handleRegenerate(localData?.layoutResultImage!, 0)}
                  className="absolute top-2 right-2"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

            </div>
          )}
          {!isAnnotationOpen && (
          <div className="space-y-4 pt-4">
            <h3 className="font-semibold">Room Layout</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="length">Length</Label>
                <Input
                  id="length"
                  placeholder="e.g., 12 ft"
                  value={localData?.length || ""}
                  onChange={(e) => updateField("length", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="breadth">Breadth</Label>
                <Input
                  id="breadth"
                  placeholder="e.g., 10 ft"
                  value={localData?.breadth || ""}
                  onChange={(e) => updateField("breadth", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="height">Height</Label>
                <Input
                  id="height"
                  placeholder="e.g., 9 ft"
                  value={localData?.height || ""}
                  onChange={(e) => updateField("height", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="windowType">Window Type</Label>
                <Input
                  id="windowType"
                  placeholder="e.g., Sliding, Casement"
                  value={localData?.windowType || ""}
                  onChange={(e) => updateField("windowType", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="windowSize">Window Size</Label>
                <Input
                  id="windowSize"
                  placeholder="e.g., 4x4 ft"
                  value={localData?.windowSize || ""}
                  onChange={(e) => updateField("windowSize", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="doorType">Door Type</Label>
                <Input
                  id="doorType"
                  placeholder="e.g., Wooden, Glass"
                  value={localData?.doorType || ""}
                  onChange={(e) => updateField("doorType", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doorSize">Door Size</Label>
                <Input
                  id="doorSize"
                  placeholder="e.g., 3x7 ft"
                  value={localData?.doorSize || ""}
                  onChange={(e) => updateField("doorSize", e.target.value)}
                />
              </div>
            </div>

          

            {/* {isAnnotationOpen && (<div className="border-t bg-white flex flex-col p-4 ">
              <div className="flex flex-col gap-2 w-full">
                <Label htmlFor="regenerate-prompt" >
                  Prompt
                </Label>
                <Textarea
                  id="regenerate-prompt"
                  placeholder="Enter your prompt for regeneration..."
                  value={regeneratePrompt}
                  onChange={(e) => setRegeneratePrompt(e.target.value)}
                  className="min-h-[40px] "
                />

              </div>

              <div className="flex justify-end gap-2 w-full mt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAnnotationOpen(false);
                    setAnnotationImageUrl("");
                    setAnnotationImageIndex(null);
                    setAnnotatedImageFile(null);
                    setRegeneratePrompt("");
                  }}
                >
                  Cancel
                </Button>

                <Button
                  type="button"
                  onClick={handleProceed}
                  disabled={isProcessing}
                >
                  {isProcessing ? "Processing..." : "Proceed"}
                </Button>
              </div>
            </div>)} */}
            </div>
          )}

        </TabsContent>

        <TabsContent value="flooring">

          {/* Flooring Section */}
          {(activeSection === "flooring" || activeSection === null) && (
            <div className={`space-y-4  pt-4`}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Flooring</h3>
                <Button type="button" size="sm" onClick={() => addArrayItem("flooring")}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>

              {/* {localData?.flooring[0] && !localData?.flooring[0].planImage && !formonly && (
                <FileUploadField
                  path="flooring[0].planImage"
                  label="Plan Image"
                  value={localData?.flooring[0].planImage}
                />
              )} */}

              {localData?.flooring[0]?.resultImage && (
                <div className="space-y-2 border-t pt-4 ">
                  <div className=" flex items-center gap-4">
                    {localData?.flooring[0]?.htmlImage && (<div className="relative">
                      <Label className="font-semibold ">Annotation Image</Label>
                      <img
                      src={localData?.flooring[0]?.htmlImage}
                      alt="Result"
                      className="w-full min-w-[180px]  max-w-[100%]  min-h-[200px] max-h-[200px] rounded-lg border object-contain"
                    />
                      <ImageExpandDialog imageUrl={localData?.flooring[0]?.htmlImage} additionalImages={[localData?.flooring[0].resultImage]} />
                    </div>)}
                    <div className="relative ">
                      <Label className="font-semibold ">Generated Image</Label>

                      <img
                        src={localData?.flooring[0].resultImage}
                        alt="Result"
                        className="w-full max-w-[100%] min-w-[100%] min-h-[200px] max-h-[200px] rounded-lg border object-contain"
                      />
                      <ImageExpandDialog imageUrl={localData?.flooring[0].resultImage} additionalImages={[localData?.flooring[0].htmlImage]} />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleRegenerate(localData?.flooring[0].resultImage!, 0)}
                        className="flex items-center gap-2 absolute top-8 right-2"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                 

                  </div>
                </div>
              )}








              {localData?.flooring?.map((item, index) => {
                if ((formonly && index !== localData?.flooring.length - 1 ) || isAnnotationOpen) return null;
                const materialImages = item.materialImages ?? [];
const lastIndex = materialImages.length - 1;
const lastMode =
  lastIndex >= 0 ? getMaterialMode(index, lastIndex) : "options";

console.log("lastMode:",lastMode)

                return (
                  <div
                    key={index}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("input, button, textarea, a, label")) return;
                      setSelectedIndex?.(selectedIndex === index ? null : index);
                    }}
                    className={`
    border rounded-lg p-4 space-y-4  cursor-pointer
    transition-all duration-200 ease-in-out
    hover:shadow-md  bg-white w-full
   ${selectedIndex === index
                        ? "border-primary bg-white"
                        : "border-gray-200 hover:border-gray-300"
                      }
  `}
                  >
                    <div className="flex items-center justify-between">
                      {editingFlooring === index ? (
                        <Input
                          className="font-medium h-8 w-auto max-w-xs"
                          value={item.name}
                          onChange={(e) => updateField(`flooring[${index}].name`, e.target.value)}
                          onBlur={() => setEditingFlooring(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setEditingFlooring(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center">
                          <h4
                            className="font-medium cursor-pointer hover:underline"
                            onDoubleClick={() => setEditingFlooring(index)}
                          >
                            {item.name || `Flooring ${index + 1}`}
                          </h4>
                          {item.annotationColor && (
                            <div
                              className="w-4 h-4 rounded-full border border-gray-300 ml-2"
                              style={{ backgroundColor: item.annotationColor }}
                              title="Annotation Color"
                            />
                          )}
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeArrayItem("flooring", index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {
                      (selectedIndex === index || formonly ) && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-2">
                              <Label>Area</Label>
                              <Input
                                value={item.area}
                                onChange={(e) => updateField(`flooring[${index}].area`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Type</Label>
                              <Input
                                value={item.type}
                                onChange={(e) => updateField(`flooring[${index}].type`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Size</Label>
                              <Input
                                value={item.size}
                                onChange={(e) => updateField(`flooring[${index}].size`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Finish</Label>
                              <Input
                                value={item.finish}
                                onChange={(e) => updateField(`flooring[${index}].finish`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Color</Label>
                              <Input
                                value={item.color}
                                onChange={(e) => updateField(`flooring[${index}].color`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Pattern</Label>
                              <Input
                                value={item.pattern}
                                onChange={(e) => updateField(`flooring[${index}].pattern`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Edge Details</Label>
                              <Input
                                value={item.edgeDetails}
                                onChange={(e) => updateField(`flooring[${index}].edgeDetails`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Skirting Type/Height</Label>
                              <Input
                                value={item.skirtingTypeHeight}
                                onChange={(e) => updateField(`flooring[${index}].skirtingTypeHeight`, e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                   <div className="flex items-center justify-between">
  <Label>Material Images</Label>

  <Button
    type="button"
    size="sm"
    variant="outline"
    onClick={() => {
      addArrayItem(`flooring[${index}].materialImages`);
      setMaterialMode((p) => ({
        ...p,
        [index]: [...(p[index] || []), "options"],
      }));
    }}
  >
    <Plus className="h-4 w-4" />
  </Button>
</div>

{/* GRID VIEW */}
<div className=" mt-3">
  {materialImages?.map((img, imgIndex) => (
    <div
      key={imgIndex}
      className="relative border rounded-lg overflow-hidden group max-w-full mb-2"
    >
      {/* Image */}
      {img.image ? (
      <div className="space-y-2">
        <div className="relative">
          <img
            src={img.image}
            alt={`Material ${imgIndex + 1}`}
            className="w-full h-32 object-contain"
          />
                      <ImageExpandDialog imageUrl={img.image} />


         
        </div>
         <div className="p-2 flex gap-2">
        <Input
          placeholder="Description"
          value={img.description || ""}
          onChange={(e) =>
            updateField(
              `flooring[${index}].materialImages[${imgIndex}].description`,
              e.target.value
            )
          }
        />
      
      </div>
      
        </div>
      ) : (
         <div className="flex gap-3 p-3 ">
    <label
  htmlFor={`material-file-${index}-${imgIndex}`}
  className="flex-1"
>
  <Button
    asChild
    size="sm"
    variant="outline"
    className="w-full"
    onClick={(e) => {
      e.stopPropagation();

      setMaterialMode((p) => ({
        ...p,
        [index]: p[index]?.map((m, i) =>
          i === imgIndex ? "browse" : m
        ),
      }));
    }}
  >
    <span>Browse</span>
  </Button>
</label>

<input
  type="file"
  accept="image/*"
  id={`material-file-${index}-${imgIndex}`}
  className="hidden"
  onChange={(e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(
        `flooring[${index}].materialImages[${imgIndex}].image`,
        file
      );
    }
  }}
/>

    <Button
      size="sm"
      variant="default"
      className="flex-1"
      onClick={(e) => {
  e.stopPropagation();
  setMaterialMode((p) => ({
    ...p,
    [index]: p[index]?.map((m, i) =>
      i === imgIndex ? "product" : m
    ),
  }));
}}

    >
      Product Library
            </Button>
            <Button
              size="icon"
              variant="destructive"
              onClick={() => {
                removeArrayItem(
                  `flooring[${index}].materialImages`,
                  imgIndex
                );

                setMaterialMode((p) => ({
                  ...p,
                  [index]: p[index]?.filter((_, i) => i !== imgIndex),
                }));
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
      )}

      {lastMode === "product" && materialImages[imgIndex]?.image === "" && (
  <div className="mt-4 w-full">
    <Products
  prod={productss.filter((p) => p.Category === "Flooring" )}
      onSelectImage={(url) => {
        updateField(
          `flooring[${index}].materialImages[${imgIndex}].image`,
          url
        )
setMaterialMode((prev) => ({
  ...prev,
  [index]: ["options"], // replace the mode array for this floor
}));
      }
      }
    />
  </div>
)}

      {/* Description */}
     
    </div>
    

    
  ))}
  
</div>



{/* PRODUCT MODE → only last image */}




                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>Reference Images</Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => addArrayItem(`flooring[${index}].referenceImages`)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            {item.referenceImages?.map((img, imgIndex) => (
                              <div key={imgIndex} className="flex gap-2 items-end">
                                <div className="flex-1 space-y-2">
                                  <Input
                                    placeholder="Description"
                                    value={img.description}
                                    onChange={(e) =>
                                      updateField(`flooring[${index}].referenceImages[${imgIndex}].description`, e.target.value)
                                    }
                                  />
                                  <div className="relative flex items-center gap-2" >
                                    <Input
                                      type="file"
                                      accept="image/*"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleFileUpload(`flooring[${index}].referenceImages[${imgIndex}].image`, file);
                                      }}
                                    />
                                    {img.image && (
                                      <>
                                        <img
                                          src={img.image}
                                          alt="Reference"
                                          className="w-32 h-20 object-cover rounded-lg border" />
                                        <ImageExpandDialog imageUrl={img.image} />
                                      </>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeArrayItem(`flooring[${index}].referenceImages`, imgIndex)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>Links</Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => addArrayItem(`flooring[${index}].links`)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            {item?.links?.map((link, linkIndex) => (
                              <div key={linkIndex} className="flex gap-2">
                                <Input
                                  value={link}
                                  onChange={(e) => updateField(`flooring[${index}].links[${linkIndex}]`, e.target.value)}
                                  placeholder="Link URL"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeArrayItem(`flooring[${index}].links`, linkIndex)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    }
                    {/* Result Image Display */}
                    {/* {item.resultImage && (
                    <div className="space-y-2 border-t pt-4">
                      <Label>Result Image</Label>
                      <div className="relative flex items-center gap-2">
                        <div className="relative flex-1">
                          <img
                            src={item.resultImage}
                            alt="Result"
                            className="w-full max-w-[200px] rounded-lg border object-contain"
                          />
                          <ImageExpandDialog imageUrl={item.resultImage} />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleRegenerate(item.resultImage!, index)}
                          className="flex items-center gap-2"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Regenerate
                        </Button>
                      </div>
                    </div>
                  )} */}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>


        {/* Ceiling Section */}
        <TabsContent value="ceiling">

          {(activeSection === "ceiling" || activeSection === null) && (
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Ceiling</h3>
                <Button type="button" size="sm" onClick={() => addArrayItem("ceiling")}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
              {/* {localData?.ceiling[0] && (!localData?.ceiling[0].resultImage) && !formonly && (
                <FileUploadField
                  path="ceiling[0].planImage"
                  label="Plan Image"
                  value={localData?.ceiling[0].planImage}
                />
              )} */}
                {localData?.ceiling[0]?.resultImage && (
                                  <div className="space-y-2 border-t pt-4">

                  <div className=" flex items-center gap-4">
                    {localData?.ceiling[0]?.htmlImage && (<div className="relative">
                      <Label className="font-semibold mb-2">Annotated Image</Label>
                      <img
                      src={localData?.ceiling[0]?.htmlImage}
                      alt="Result"
                      className="w-full max-w-[100%] min-w-[180px]  min-h-[200px] max-h-[200px] rounded-lg border object-contain"
                    />
                      <ImageExpandDialog imageUrl={localData?.ceiling[0]?.htmlImage} additionalImages={[localData?.ceiling[0].resultImage]} />
                    </div>)}
                    <div className="relative">
                      <Label className="font-semibold mb-2">Generated Image</Label>

                      <img
                        src={localData?.ceiling[0].resultImage}
                        alt="Result"
                        className="w-full max-w-[100%] min-w-[100%] min-h-[200px] max-h-[200px] rounded-lg border object-contain"
                      />
                      <ImageExpandDialog imageUrl={localData?.ceiling[0].resultImage} additionalImages={[localData?.ceiling[0].htmlImage]} />
                      <Button type="button" size="sm" variant="outline" onClick={() => handleRegenerate(localData?.ceiling[0].resultImage!, 0)} className="absolute top-8 right-2">
                        <RefreshCw className="h-4 w-4 " />
                      </Button>
                    </div>
                  

                
                  </div>
                                    </div>

                )}
             

              {localData?.ceiling?.map((item, index) => {
                if ((formonly && index !== localData?.ceiling.length - 1 ) || isAnnotationOpen) return null;

                 const materialImages = item.ceilingMaterials ?? [];
const lastIndex = materialImages.length - 1;
const lastMode =
  lastIndex >= 0 ? getMaterialMode(index, lastIndex) : "options";

console.log("lastMode:",lastMode)

                return (
                  <div
                    key={index}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("input, button, textarea, a, label")) return;
                      setSelectedIndex?.(selectedIndex === index ? null : index);
                    }}
                    className={`
    border rounded-lg p-4 space-y-4  cursor-pointer
    transition-all duration-200 ease-in-out
    hover:shadow-md  bg-white
      ${selectedIndex === index
                        ? "border-primary bg-white"
                        : "border-gray-200 hover:border-gray-300 "
                      }
  `}
                  >
                    <div className="flex items-center justify-between">
                      {editingCeiling === index ? (
                        <Input
                          className="font-medium h-8 w-auto max-w-xs"
                          value={item.name}
                          onChange={(e) => updateField(`ceiling[${index}].name`, e.target.value)}
                          onBlur={() => setEditingCeiling(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setEditingCeiling(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center">
                          <h4
                            className="font-medium cursor-pointer hover:underline"
                            onDoubleClick={() => setEditingCeiling(index)}
                          >
                            {item.name || `Ceiling ${index + 1}`}
                          </h4>
                          {item.annotationColor && (
                            <div
                              className="w-4 h-4 rounded-full border border-gray-300 ml-2"
                              style={{ backgroundColor: item.annotationColor }}
                              title="Annotation Color"
                            />
                          )}
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeArrayItem("ceiling", index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {
                      (selectedIndex === index || formonly ) && (
                        <>
                          {/* <FileUploadField path={`ceiling[${index}].planImage`} label="Plan Image" value={item.planImage} /> */}
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-2">
                              <Label>Area</Label>
                              <Input
                                value={item.area}
                                onChange={(e) => updateField(`ceiling[${index}].area`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Type</Label>
                              <Input
                                value={item.type}
                                onChange={(e) => updateField(`ceiling[${index}].type`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Height from FFL</Label>
                              <Input
                                value={item.heightFromFFL}
                                onChange={(e) => updateField(`ceiling[${index}].heightFromFFL`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Cove Details</Label>
                              <Input
                                value={item.coveDetails}
                                onChange={(e) => updateField(`ceiling[${index}].coveDetails`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Light Fixtures</Label>
                              <Input
                                value={item.lightFixtures}
                                onChange={(e) => updateField(`ceiling[${index}].lightFixtures`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Pattern/Shape</Label>
                              <Input
                                value={item.patternOrShape}
                                onChange={(e) => updateField(`ceiling[${index}].patternOrShape`, e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Color</Label>
                              <Input
                                value={item.color}
                                onChange={(e) => updateField(`ceiling[${index}].color`, e.target.value)}
                              />
                            </div>
                          </div>
                         <div className="space-y-2">
  {/* Header */}
  <div className="flex items-center justify-between">
    <Label>Ceiling Materials</Label>
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        addArrayItem(`ceiling[${index}].ceilingMaterials`);
        setMaterialMode((p) => ({
          ...p,
          [index]: [...(p[index] || []), "options"],
        }));
      }}
    >
      <Plus className="h-4 w-4" />
    </Button>
  </div>

  {/* Grid / Items */}
  {item.ceilingMaterials?.map((img, imgIndex) => (
    <div key={imgIndex} className="flex gap-3 items-end">
      <div className="flex-1 space-y-2">
        {/* Description */}
      

        {/* Image / Buttons */}
        {img.image ? (
          <div className="relative">
            <img
              src={img.image}
              alt={`Ceiling Material ${imgIndex + 1}`}
              className="w-full h-32 object-contain rounded-lg border"
            />
            <ImageExpandDialog imageUrl={img.image} />
          </div>
        ) : (
          <div className="flex gap-3">
            <label
              htmlFor={`ceiling-file-${index}-${imgIndex}`}
              className="flex-1"
            >
              <Button
                asChild
                size="sm"
                variant="outline"
                className="w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  setMaterialMode((p) => ({
                    ...p,
                    [index]: p[index]?.map((m, i) =>
                      i === imgIndex ? "browse" : m
                    ),
                  }));
                }}
              >
                <span>Browse</span>
              </Button>
            </label>

            <input
              type="file"
              accept="image/*"
              id={`ceiling-file-${index}-${imgIndex}`}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  handleFileUpload(
                    `ceiling[${index}].ceilingMaterials[${imgIndex}].image`,
                    file
                  );
              }}
            />

            <Button
              size="sm"
              variant="default"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation();
                setMaterialMode((p) => ({
                  ...p,
                  [index]: p[index]?.map((m, i) =>
                    i === imgIndex ? "product" : m
                  ),
                }));
              }}
            >
              Product Library
            </Button>
          </div>
        )}
          <Input
          placeholder="Description"
          value={img.description || ""}
          onChange={(e) =>
            updateField(
              `ceiling[${index}].ceilingMaterials[${imgIndex}].description`,
              e.target.value
            )
          }
        />

        {/* Product Library Selection */}
        {lastMode === "product" && materialImages[imgIndex]?.image === "" && (
            <div className="w-full mt-4">
              <Products
                prod={productss.filter(
                  (p) =>
                    p.Category === "Acoustics" || p.Category === "Office Ceiling"
                )}
                onSelectImage={(url) => {
                  updateField(
                    `ceiling[${index}].ceilingMaterials[${imgIndex}].image`,
                    url
                  );
                  setMaterialMode((prev) => ({
                    ...prev,
                    [index]: prev[index]?.map(() => "options"),
                  }));
                }}
              />
            </div>
          )}
      </div>

      {/* Remove Button */}
      <Button
        type="button"
        variant="destructive"
        size="icon"
        onClick={() => {
          removeArrayItem(
            `ceiling[${index}].ceilingMaterials`,
            imgIndex
          );
          setMaterialMode((p) => ({
            ...p,
            [index]: p[index]?.filter((_, i) => i !== imgIndex),
          }));
        }}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  ))}
</div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>Reference Images</Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => addArrayItem(`ceiling[${index}].referenceImages`)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            {item.referenceImages?.map((img, imgIndex) => (
                              <div key={imgIndex} className="flex gap-2 items-end">
                                <div className="flex-1 space-y-2">
                                  <Input
                                    placeholder="Description"
                                    value={img.description}
                                    onChange={(e) =>
                                      updateField(`ceiling[${index}].referenceImages[${imgIndex}].description`, e.target.value)
                                    }
                                  />
                                  <div className="relative flex items-center gap-2" >
                                    <Input
                                      type="file"
                                      accept="image/*"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleFileUpload(`ceiling[${index}].referenceImages[${imgIndex}].image`, file);
                                      }}
                                    />
                                    {img.image && (
                                      <>
                                        <img
                                          src={img.image}
                                          alt="Reference"
                                          className="w-32 h-20 object-cover rounded-lg border"
                                        />
                                        <ImageExpandDialog imageUrl={img.image} />
                                      </>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeArrayItem(`ceiling[${index}].referenceImages`, imgIndex)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>Links</Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => addArrayItem(`ceiling[${index}].links`)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            {item?.links?.map((link, linkIndex) => (
                              <div key={linkIndex} className="flex gap-2">
                                <Input
                                  value={link}
                                  onChange={(e) => updateField(`ceiling[${index}].links[${linkIndex}]`, e.target.value)}
                                  placeholder="Link URL"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeArrayItem(`ceiling[${index}].links`, linkIndex)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    }
                    {/* Result Image Display */}

                  </div>
                );
              })}
            </div>
          )}    </TabsContent>


        {/* Walls Section */}
        <TabsContent value="walls">

          {(activeSection === "walls" || activeSection === null) && (
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Walls</h3>
                <Button type="button" size="sm" onClick={() => addArrayItem("walls")}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
              {/* {localData?.walls[0] && !formonly && !localData?.walls[0].planImage && (
                <FileUploadField
                  path="walls[0].planImage"
                  label="Plan Image"
                  value={localData?.walls[0].planImage}
                />
              )} */}
              <div className="flex gap-4 border-t pt-4">
                {localData?.walls[0]?.htmlImage && (<div className="relative">
                  <Label>Annotation Image</Label>
                  <img
                  src={localData?.walls[0]?.htmlImage}
                  alt="Result"
                  className="w-full max-w-[100%] min-w-[180px] min-h-[200px] max-h-[200px] rounded-lg border object-contain"
                />
                  <ImageExpandDialog imageUrl={localData?.walls[0]?.htmlImage} additionalImages={[localData?.walls[0].resultImage]} />
                </div>)}
                {localData?.walls[0]?.resultImage && !formonly && (
                  <div className="space-y-2 ">
                    <Label>Generated Image</Label>
                    <div className="relative">
                      <img
                        src={localData?.walls[0].resultImage}
                        alt="Result"
                        className="w-full max-w-[100%] min-w-[100%] min-h-[200px] max-h-[200px] rounded-lg border object-contain"
                      />
                      <ImageExpandDialog imageUrl={localData?.walls[0].resultImage} additionalImages={[localData?.walls[0].htmlImage]} />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"

                        onClick={() => handleRegenerate(localData?.walls[0].resultImage!, 0)}
                        className="absolute top-6 right-2"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              
              </div>

              {localData?.walls?.map((item, index) => {
                if ((formonly && index !== localData?.walls.length - 1) || isAnnotationOpen) return null;
                return (
                  <div
                    key={index}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("input, button, textarea, a, label")) return;
                      setSelectedIndex?.(selectedIndex === index ? null : index);
                    }}
                    className={`
    border rounded-lg p-4 space-y-4 cursor-pointer
    transition-all duration-200 ease-in-out
    hover:shadow-md  bg-white
      ${selectedIndex === index
                        ? "border-primary bg-white"
                        : "border-gray-200 hover:border-gray-300 "
                      }
  `}
                  >
                    <div className="flex items-center justify-between">
                      {editingWall === index ? (
                        <Input
                          className="font-medium h-8 w-auto max-w-xs"
                          value={item.name}
                          onChange={(e) => updateField(`walls[${index}].name`, e.target.value)}
                          onBlur={() => setEditingWall(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setEditingWall(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center">
                          <h4
                            className="font-medium cursor-pointer hover:underline"
                            onDoubleClick={() => setEditingWall(index)}
                          >
                            {item.name || `Wall ${index + 1}`}
                          </h4>
                          {item.annotationColor && (
                            <div
                              className="w-4 h-4 rounded-full border border-gray-300 ml-2"
                              style={{ backgroundColor: item.annotationColor }}
                              title="Annotation Color"
                            />
                          )}


                        </div>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeArrayItem("walls", index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {(selectedIndex === index || formonly) && (
                      <>
                        <div className="space-y-2">
                          <Label>Wall Name</Label>
                          <Input
                            value={item.wallName}
                            onChange={(e) => updateField(`walls[${index}].wallName`, e.target.value)}
                          />
                        </div>
                        {/* <FileUploadField path={`walls[${index}].planImage`} label="Plan Image" value={item.planImage} /> */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-2">
                            <Label>Length </Label>
                            <Input
                              value={item.length}
                              onChange={(e) => updateField(`walls[${index}].length`, e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Material</Label>
                            <Input
                              value={item.material}
                              onChange={(e) => updateField(`walls[${index}].material`, e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Color Code</Label>
                            <Input
                              value={item.colorCode}
                              onChange={(e) => updateField(`walls[${index}].colorCode`, e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Panel Size/Arrangement</Label>
                            <Input
                              value={item.panelSizeOrArrangement}
                              onChange={(e) => updateField(`walls[${index}].panelSizeOrArrangement`, e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Texture</Label>
                            <Input
                              value={item.texture}
                              onChange={(e) => updateField(`walls[${index}].texture`, e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Special Features</Label>
                            <Input
                              value={item.specialFeatures}
                              onChange={(e) => updateField(`walls[${index}].specialFeatures`, e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Artwork/Signage</Label>
                            <Input
                              value={item.anyArtworkOrSignage}
                              onChange={(e) => updateField(`walls[${index}].anyArtworkOrSignage`, e.target.value)}
                            />
                          </div>
                        </div>
<div className="space-y-2">
  <Label>Finish Material Image</Label>

  <div className="flex gap-3 items-center">
    {/* Browse Button */}
    <label htmlFor={`finish-material-${index}`} className="flex-1">
      <Button
        asChild
        size="sm"
        variant="outline"
        className="w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <span>Browse</span>
      </Button>
    </label>

    <input
      type="file"
      accept="image/*"
      id={`finish-material-${index}`}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleFileUpload(`walls[${index}].finishMaterialImages`, file);
      }}
    />

    {/* Product Library Button */}
    <Button
      size="sm"
      variant="default"
      className="flex-1"
      onClick={() => {
        setMaterialMode((p) => ({
          ...p,
          [`finishMaterial-${index}`]: "product",
        }));
      }}
    >
      Product Library
    </Button>
  </div>

  {/* Image Preview */}
  {item.finishMaterialImages && (
    <div className="relative mt-2">
      <img
        src={item.finishMaterialImages}
        alt="Finish Material"
        className="w-full h-32 object-contain rounded-lg border"
      />
      <ImageExpandDialog imageUrl={item.finishMaterialImages} />
    </div>
  )}

  {/* Product Library Selection */}
  {materialMode[`finishMaterial-${index}`] === "product" && (
      <div className="w-full mt-2">
        <Products
          prod={productss.filter(
            (p) =>
              p.Category === "Acoustic Solutions" 
          )}
          onSelectImage={(url) => {
            updateField(
              `walls[${index}].finishMaterialImages`,
              url
            );
            setMaterialMode((prev) => ({
              ...prev,
              [`finishMaterial-${index}`]: "options",
            }));
          }}
        />
      </div>
    )}
</div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>Reference Images</Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => addArrayItem(`walls[${index}].referenceImages`)}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          {item.referenceImages?.map((img, imgIndex) => (
                            <div key={imgIndex} className="flex gap-2 items-end">
                              <div className="flex-1 space-y-2">
                                <Input
                                  placeholder="Description"
                                  value={img.description}
                                  onChange={(e) =>
                                    updateField(`walls[${index}].referenceImages[${imgIndex}].description`, e.target.value)
                                  }
                                />
                                <div className="relative flex items-center gap-2" >
                                  <Input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handleFileUpload(`walls[${index}].referenceImages[${imgIndex}].image`, file);
                                    }}
                                  />
                                  {img.image && (
                                    <>
                                      <img
                                        src={img.image}
                                        alt="Reference"
                                        className="w-32 h-20 object-cover rounded-lg border"
                                      />
                                      <ImageExpandDialog imageUrl={img.image} />
                                    </>
                                  )}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeArrayItem(`walls[${index}].referenceImages`, imgIndex)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {/* Result Image Display */}

                  </div>
                );
              })}
            </div>
          )}    </TabsContent>

        {/* Furniture Section */}
        <TabsContent value="furniture">

          {(activeSection === "furniture" || activeSection === null) && (
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center ">
                <h3 className="font-semibold">Furniture</h3>
                {localData?.furniture.annotationColor && (
                  <div
                    className="w-4 h-4 rounded-full border border-gray-300 ml-2"
                    style={{ backgroundColor: localData?.furniture.annotationColor }}
                    title="Annotation Color"
                  />
                )}
              </div>

              {/* {!formonly && !localData?.furniture.resultImage && (
                <FileUploadField path="furniture.planImage" label="Plan Image" value={localData?.furniture.planImage} />
              )} */}
              {localData?.furniture?.resultImage && (
                <div className="space-y-2 border-t pt-4">
                  <Label>Generated Image</Label>
                  <div className="relative w-[200px]">
                    <img
                      src={localData?.furniture.resultImage}
                      alt="Result"
                      className="w-[200px] max-w-[200px] rounded-lg border object-contain"
                    />
                    <ImageExpandDialog imageUrl={localData?.furniture.resultImage} />
                    <Button onClick={() => handleRegenerate(localData?.furniture.resultImage)} className="absolute top-2 right-2" variant="outline"><RefreshCw /></Button>
                  </div>
                  
                </div>

              )}



             {!isAnnotationOpen && (
  <>
    {/* BASIC DETAILS */}
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-2">
        <Label>Dimensions</Label>
        <Input
          value={localData?.furniture.dimensions}
          onChange={(e) =>
            updateField("furniture.dimensions", e.target.value)
          }
        />
      </div>

      <div className="space-y-2">
        <Label>Laminate Color</Label>
        <Input
          value={localData?.furniture.laminateColor}
          onChange={(e) =>
            updateField("furniture.laminateColor", e.target.value)
          }
        />
      </div>

      <div className="space-y-2">
        <Label>Leg Color</Label>
        <Input
          value={localData?.furniture.legColor}
          onChange={(e) =>
            updateField("furniture.legColor", e.target.value)
          }
        />
      </div>
    </div>

    {/* ================= CHAIR LINKS ================= */}
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Chair Links</Label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => addArrayItem("furniture.chairLinks")}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {localData?.furniture.chairLinks?.map((link, linkIndex) => {
        const key = `chair-${linkIndex}`;

        return (
          <div key={linkIndex} className="border rounded p-3 space-y-2">
            <Input
              placeholder="Chair URL"
              value={link}
              onChange={(e) =>
                updateField(
                  `furniture.chairLinks[${linkIndex}]`,
                  e.target.value
                )
              }
            />

            <div className="flex gap-2 w-full">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() =>
                  setMaterialMode((p) => ({ ...p, [key]: "product" }))
                }
              >
                Product Library
              </Button>

              <Button
                size="icon"
                variant="destructive"
                onClick={() =>
                  removeArrayItem("furniture.chairLinks", linkIndex)
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {getMode(key) === "product" && (
              <Products
          prod={productss.filter((p) => p.Category === "Furniture" || p.Category === "Office furniture")}
                onSelectImage={(url) => {
                  updateField(
                    `furniture.chairLinks[${linkIndex}]`,
                    url
                  );
                  setMaterialMode((p) => ({
                    ...p,
                    [key]: "options",
                  }));
                }}
              />
            )}
          </div>
        );
      })}
    </div>

    {/* ================= TABLE DETAILS ================= */}
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Table Details</Label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => addArrayItem("furniture.tableDetails")}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {localData?.furniture.tableDetails?.map((detail, detailIndex) => {
        const key = `table-${detailIndex}`;

        return (
          <div key={detailIndex} className="border rounded p-3 space-y-2">
            <div className="flex justify-between items-center">
              <h5 className="font-medium">
                {detail.name || `Table ${detailIndex + 1}`}
              </h5>
              <Button
                size="icon"
                variant="destructive"
                onClick={() =>
                  removeArrayItem("furniture.tableDetails", detailIndex)
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-3 w-full gap-2">
              <Input
                placeholder="Material"
                value={detail.material}
                onChange={(e) =>
                  updateField(
                    `furniture.tableDetails[${detailIndex}].material`,
                    e.target.value
                  )
                }
              />
              <Input
                placeholder="Color"
                value={detail.color}
                onChange={(e) =>
                  updateField(
                    `furniture.tableDetails[${detailIndex}].color`,
                    e.target.value
                  )
                }
              />
              <Input
                placeholder="Link"
                value={detail.link}
                onChange={(e) =>
                  updateField(
                    `furniture.tableDetails[${detailIndex}].link`,
                    e.target.value
                  )
                }
              />
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setMaterialMode((p) => ({ ...p, [key]: "product" }))
              }
            >
              Product Library
            </Button>

            {getMode(key) === "product" && (
              <Products
          prod={productss.filter((p) => p.Category === "Furniture" || p.Category === "Office furniture")}
                onSelectImage={(url) => {
                  updateField(
                    `furniture.tableDetails[${detailIndex}].link`,
                    url
                  );
                  setMaterialMode((p) => ({
                    ...p,
                    [key]: "options",
                  }));
                }}
              />
            )}
          </div>
        );
      })}
    </div>

    {/* ================= REFERENCE IMAGES ================= */}
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Lighting and Decor</Label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => addArrayItem("furniture.referenceImage")}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

    {localData?.furniture.referenceImage?.map((item, imgIndex) => {
  const key = `ref-${imgIndex}`;
  const img = item?.image;

  return (
    <div key={imgIndex} className="border rounded p-3 space-y-2 w-full">
      
      {/* IMAGE SECTION */}
      {!img ? (
        <div className="flex gap-2">
          <label htmlFor={key} className="flex-1">
            <Button asChild variant="outline" className="w-full">
              <span>Browse</span>
            </Button>
          </label>

          <input
            id={key}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                handleFileUpload(
                  `furniture.referenceImage[${imgIndex}].image`,
                  file
                );
            }}
          />

          <Button
            className="flex-1"
            onClick={() =>
              setMaterialMode((p) => ({
                ...p,
                [key]: "product",
              }))
            }
          >
            Product Library
          </Button>
        </div>
      ) : (
        <div className="relative">
          <img
            src={img}
            className="w-32 h-20 object-cover rounded border"
          />
          <ImageExpandDialog imageUrl={img} />
        </div>
      )}

      {/* PRODUCT LIBRARY */}
      {getMode(key) === "product" && !img && (
        <Products
          prod={productss.filter((p) => p.Category === "Lighting" || p.Category === "Decoration")}
          onSelectImage={(url) => {
            updateField(
              `furniture.referenceImage[${imgIndex}].image`,
              url
            );
            setMaterialMode((p) => ({
              ...p,
              [key]: "options",
            }));
          }}
        />
      )}

      {/* DESCRIPTION INPUT */}
      <div className="flex gap-2">
     <Input
          placeholder="Description"
        value={item?.description || ""}
        onChange={(e) =>
          updateField(
            `furniture.referenceImage[${imgIndex}].description`,
            e.target.value
          )
        }
      />

      {/* REMOVE BUTTON */}
      <Button
        size="icon"
        variant="destructive"
        onClick={() =>
          removeArrayItem("furniture.referenceImage", imgIndex)
        }
      >
        <X className="h-4 w-4" />
      </Button>
      </div>
    </div>
  );
})}

    </div>
  </>
)}

              {/* Result Image Display */}

            </div>
          )}
        </TabsContent>
      </Tabs>
{!formonly && !isAnnotationOpen &&
        <Button className="w-full text-right my-4" onClick={() => {
          setSelectedIndex(null);
          handleExportLayout()
        }}>
  Save
</Button>}

      {isAnnotationOpen && (<div className="border-t bg-white flex flex-col p-4 mt-4 ">
        <div className="flex flex-col gap-2 w-full">
          <Label htmlFor="regenerate-prompt" className="text-sm font-medium mb-2">
            Prompt
          </Label>
          <Textarea
            id="regenerate-prompt"
            placeholder="Enter your prompt for regeneration..."
            value={regeneratePrompt}
            onChange={(e) => setRegeneratePrompt(e.target.value)}
            className="min-h-[40px] "
          />

        </div>

        <div className="flex justify-end gap-2 w-full mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setIsAnnotationOpen(false);
              setAnnotationImageUrl("");
              setAnnotationImageIndex(null);
              setAnnotatedImageFile(null);
              setRegeneratePrompt("");
            }}
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={handleProceed}
            disabled={isProcessing}
          >
            {isProcessing ? "Processing..." : "Proceed"}
          </Button>
        </div>
      </div>)}

      <LoadingPopup show={showLoader} progress={loadingPercent} />


      {/* Annotation Dialog with Prompt and Proceed Button */}
      {/* <Dialog open={isAnnotationOpen} onOpenChange={setIsAnnotationOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 flex flex-col gap-0 z-50">
          <div className="flex-1 overflow-hidden min-h-0" style={{ height: 'calc(95vh - 200px)' }}>
            {annotationImageUrl && (
              <div className="h-full w-full overflow-hidden">
                <div style={{ height: '100%', width: '100%' }}>
                  <ImageAnnotator
                    uploadedFile={null}
                    imageSource={annotationImageUrl}
                    initialAnnotations={[]}
                    onSave={handleAnnotationSave}
                    onClose={() => setIsAnnotationOpen(false)}
                    showToolbar={true}
                    allowFreehand={true}
                    allowShapes={true}
                    allowText={true}
                    inline={true}
                    otherannotation={true}
                  />
                </div>
              </div>
            )}
          </div>
          
          <div className="border-t bg-white flex flex-col p-4 ">
            <div className="flex flex-col gap-2 w-full">
              <Label htmlFor="regenerate-prompt" className="text-center">
                Prompt
              </Label>
              <Textarea
                id="regenerate-prompt"
                placeholder="Enter your prompt for regeneration..."
                value={regeneratePrompt}
                onChange={(e) => setRegeneratePrompt(e.target.value)}
                className="min-h-[40px] w-[50%] mx-auto"
              />

            </div>

            <div className="flex justify-end gap-2 w-full">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAnnotationOpen(false);
                  setAnnotationImageUrl("");
                  setAnnotationImageIndex(null);
                  setAnnotatedImageFile(null);
                  setRegeneratePrompt("");
                }}
              >
                Cancel
              </Button>

              <Button
                type="button"
                onClick={handleProceed}
                disabled={isProcessing}
              >
                {isProcessing ? "Processing..." : "Proceed"}
              </Button>
            </div>
          </div>

        </DialogContent>
      </Dialog> */}

    </ScrollArea >
  );
}

