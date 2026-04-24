import { useState, useRef, useEffect } from "react";
import { Search, Mic, Camera, SlidersHorizontal, X, Clock, TrendingUp, Sparkles, Package, Plus, Upload, Send, Loader2, Layout, FileText, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { schemaGetServiceByEntity, uploadImageToS3, postServiceByEntity } from "@/api/action";
import { useToast } from "@/hooks/use-toast";
import DynamicForm from "./dynamicform";
import { useParams, useNavigate } from "react-router-dom";

import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;


type CardType = "moodboard" | "room-layout" | "furniture-bundle" | "boq" | "room-generation" | "floorplan-room-generation" | "design-with-inputs" | "innova-design";

interface SearchDockProps {
  image?: string | null;
  setImage?: (image: string | null) => void;
  onSearch?: (query: string) => void;
  onOptionSelect?: (option: "moodboard" | "complete-furniture") => void;
  onFormSubmit?: (data: { cardType: CardType; text: string; image?: string; voice?: Blob,dynamicformData?: any }) => void;
  showOptions?: boolean;
}

export const SearchDock = ({ image,setImage,onSearch, onOptionSelect, onFormSubmit, showOptions = false }: SearchDockProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCardType, setSelectedCardType] = useState<CardType | null>(null);
  
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Card-specific form fields
  const [roomType, setRoomType] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [size, setSize] = useState("");
  const [capacity, setCapacity] = useState("");
  const [projectInfo, setProjectInfo] = useState("");
  const [designStyle, setDesignStyle] = useState("");
  const [schema, setSchema] = useState<any>(null);
  const [dynamicFormData, setDynamicFormData] = useState(null);
  const [showInnovaSelection, setShowInnovaSelection] = useState(false);
  const [innovaMode, setInnovaMode] = useState<"2D" | "3D" | "2D-3D" | null>(null);

  const recentSearches = [
    "Minimalist bedroom",
    "Warm living room",
    "Scandinavian kitchen"
  ];

  const trendingPrompts = [
    "Japandi style dining",
    "Biophilic workspace",
    "Coastal bathroom"
  ];

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query && !image && !voiceBlob) return;

    // If card type is selected, use form submit
    if (selectedCardType && onFormSubmit) {
      await handleFormSubmit();
      return;
    }

    // Otherwise, use regular search
    if (query) {
      onSearch(query);
      setIsExpanded(false);
    }
  };

  const handleCardTypeSelect = async(type: CardType) => {
    setSelectedCardType(type);
    if(type==="design-with-inputs"){
    setIsExpanded(true);
      const schema=await schemaGetServiceByEntity("693912f21bedc936c4324848");
      const schemaa={
  formTitle: "Floor Plan",
  fields: [
    {
      fieldName: "Rooms",
      id: "rooms",
      fieldType: "array",
      arraySubfields: 
        schema?.entity}
      
      ]}
      setSchema(schema?.entity);
      setIsExpanded(true);
    } else if(type==="innova-design"){
      setShowInnovaSelection(true);
    }

  
  }
  const pdfjsLibRef = useRef<any>(null);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        // Dynamic import for Next.js compatibility
        const pdfjsLib = await import("pdfjs-dist");
        const pdfjsWorker = await import(
          "pdfjs-dist/build/pdf.worker.min.mjs?url"
        );

        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker.default;

        if (isMounted) {
          pdfjsLibRef.current = pdfjsLib;
        }
      } catch (err) {
        console.error("Error loading PDF.js", err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  
  const getFirstPageFromPDF = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    return canvas.toDataURL("image/png");
  };

  const handleImageSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageFile(file);

    // 📄 PDF
    if (file.type === "application/pdf" && innovaMode === "2D") {
      try {
        const firstPageImage = await getFirstPageFromPDF(file);
        setImage(firstPageImage);

        if (selectedCardType === "innova-design") {
          navigate("/innova-design", {
            state: { file, previewImage: firstPageImage },
          });
        }
      } catch (err) {
        console.error("PDF error", err);
      }
      return;
    }

    // 🏗 IFC / 3D
    if (innovaMode === "3D" || file.name.toLowerCase().endsWith(".ifc")) {
      if (selectedCardType === "innova-design") {
        navigate("/building-configurator", { state: { file } });
        return;
      }
    }

    if (innovaMode === "2D-3D" || file.name.toLowerCase().endsWith(".glb")) {
      if (selectedCardType === "innova-design") {
        navigate("/3d-model", { state: { file } });
        return;
      }
    }

    // 🖼 Image
    const reader = new FileReader();
    reader.onloadend = () => setImage(reader.result as string);
    reader.readAsDataURL(file);

    if (selectedCardType === "innova-design") {
      const uploadAndNavigate = async () => {
        setIsSubmitting(true);
        try {
          const s3Url = await uploadImageToS3(file);
          if (!s3Url) throw new Error("Upload failed");

          const room = [{
            roomName: "Room 1",
            area: "",
            planImage: s3Url,
             versionImage:[{versionIndex:0,image:s3Url}],
             versions:[{images:"",inputs:{materialImages:[{image:"",description:""}]}}],
           
          }];

          const response = await postServiceByEntity("69d0b54cad8abad1ca92d84b", {
            rooms: room,
          });

          if (response._id) {
            if (innovaMode === "3D" || file.name.toLowerCase().endsWith(".ifc")) {
              navigate(`/building-configurator/${response._id}`);
            } else if (innovaMode === "2D-3D" || file.name.toLowerCase().endsWith(".glb")) {
              navigate(`/3d-model/${response._id}`);
            } else {
              navigate(`/innova-design/${response._id}`);
            }
          }
        } catch (error) {
          console.error("Error starting innova-design flow:", error);
          toast({ title: "Error", description: "Failed to start design flow", variant: "destructive" });
        } finally {
          setIsSubmitting(false);
          setImage(null);
          setImageFile(null);
          setSelectedCardType(null);
          setIsExpanded(false);
        }
      };
      uploadAndNavigate();
    }
  };

  const handleVoiceRecord = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
      }
    } else {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          alert("Voice recording is not supported in your browser");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          setVoiceBlob(audioBlob);
          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.onerror = (event) => {
          console.error("MediaRecorder error:", event);
          setIsRecording(false);
          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (error) {
        console.error("Error accessing microphone:", error);
        alert("Could not access microphone. Please check your permissions.");
      }
    }
  };

  const handleFormSubmit = async () => {
    if (!selectedCardType || (!searchQuery.trim() && !image && !voiceBlob)) {
      return;
    }

    // Handle innova-design: navigate to ImageAnnotation page with file
    if (selectedCardType === "innova-design") {
      if (!imageFile && !image) {
        toast({
          title: "Image Required",
          description: "Please upload an image to proceed",
          variant: "destructive",
        });
        return;
      }
      
      // Navigate to ImageAnnotation page with the file
      if (imageFile) {
        navigate("/innova-design", { 
          state: { file: imageFile } 
        });
      } else if (image) {
        navigate("/innova-design", { 
          state: { imageSource: image } 
        });
      }
      
      // Reset form
      setSearchQuery("");
      setImage(null);
      setImageFile(null);
      setVoiceBlob(null);
      setSelectedCardType(null);
      setIsExpanded(false);
      return;
    }

    // Validate room-generation: image is mandatory
    if (selectedCardType === "room-generation") {
      if (!imageFile && !image) {
        toast({
          title: "Image Required",
          description: "Please upload image for proceed",
          variant: "destructive",
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      let imageUrl: string | undefined;

      if (imageFile) {
        const uploadedUrl = await uploadImageToS3(imageFile);
        if (uploadedUrl) {
          imageUrl = uploadedUrl;
        }
      } else if (image) {
        // If image is already a URL string, use it directly
        imageUrl = image;
      }

      // Build query text with card-specific fields
      let queryText = searchQuery.trim();
      const additionalFields: string[] = [];

      if (selectedCardType === "room-layout") {
        if (roomType) additionalFields.push(`Room Type: ${roomType}`);
        if (dimensions) additionalFields.push(`Dimensions: ${dimensions}`);
      } else if (selectedCardType === "furniture-bundle") {
        if (roomType) additionalFields.push(`Room Type: ${roomType}`);
        if (size) additionalFields.push(`Size: ${size}`);
        if (capacity) additionalFields.push(`Capacity: ${capacity}`);
      } else if (selectedCardType === "boq") {
        if (projectInfo) additionalFields.push(`Project Info: ${projectInfo}`);
      } else if (selectedCardType === "room-generation") {
        if (roomType) additionalFields.push(`Room Type: ${roomType}`);
        if (designStyle) additionalFields.push(`Design Style: ${designStyle}`);
      }

      if (additionalFields.length > 0) {
        queryText = queryText 
          ? `${queryText}. ${additionalFields.join(", ")}`
          : additionalFields.join(", ");
      }

      onFormSubmit?.({
        cardType: selectedCardType,
        text: queryText,
        image: imageUrl,
        voice: voiceBlob || undefined,
      });

      // Reset form
      setSearchQuery("");
      setImage(null);
      setImageFile(null);
      setVoiceBlob(null);
      setSelectedCardType(null);
      setRoomType("");
      setDimensions("");
      setSize("");
      setCapacity("");
      setProjectInfo("");
      setDesignStyle("");
      setIsExpanded(false);
    } catch (error) {
      console.error("Error submitting form:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCardTypeLabel = (type: CardType) => {
    switch (type) {
      case "moodboard":
        return "Moodboard";
      case "room-layout":
        return "Room Layout";
      case "furniture-bundle":
        return "Furniture Bundle";
      case "boq":
        return "BOQ";
      case "room-generation":
        return "Room Generation";
      case "floorplan-room-generation":
        return "Floorplan Room Generation";
        case "design-with-inputs":
          return "Design With Inputs";
        case "innova-design":
          return "Innova Design";

      default:
        return "";
    }
  };


  const renderCardSpecificFields = () => {
    if (!selectedCardType) return null;

    switch (selectedCardType) {
      case "room-layout":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="roomType">Room Type</Label>
              <Input
                id="roomType"
                value={roomType}
                onChange={(e) => setRoomType(e.target.value)}
                placeholder="e.g., Living Room, Bedroom"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dimensions">Dimensions</Label>
              <Input
                id="dimensions"
                value={dimensions}
                onChange={(e) => setDimensions(e.target.value)}
                placeholder="e.g., 12ft x 15ft"
                className="rounded-xl"
              />
            </div>
          </div>
        );
      case "furniture-bundle":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="roomType">Room Type</Label>
              <Input
                id="roomType"
                value={roomType}
                onChange={(e) => setRoomType(e.target.value)}
                placeholder="e.g., Living Room, Bedroom"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="size">Size</Label>
              <Input
                id="size"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g., Small, Medium, Large"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="capacity">Capacity</Label>
              <Input
                id="capacity"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="e.g., 2-4 people"
                className="rounded-xl"
              />
            </div>
          </div>
        );
      case "boq":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="projectInfo">Project Information</Label>
              <Textarea
                id="projectInfo"
                value={projectInfo}
                onChange={(e) => setProjectInfo(e.target.value)}
                placeholder="Enter project details, location, etc."
                className="min-h-[80px] resize-none rounded-xl"
              />
            </div>
          </div>
        );
      case "room-generation":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="roomTypeGen">Room Type <span className="text-destructive">*</span></Label>
              <Select
                value={roomType}
                onValueChange={setRoomType}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select room type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Living Room">Living Room</SelectItem>
                  <SelectItem value="Bedroom">Bedroom</SelectItem>
                  <SelectItem value="Kitchen">Kitchen</SelectItem>
                  <SelectItem value="Bathroom">Bathroom</SelectItem>
                  <SelectItem value="Dining Room">Dining Room</SelectItem>
                  <SelectItem value="Office">Office</SelectItem>
                  <SelectItem value="Study Room">Study Room</SelectItem>
                  <SelectItem value="Guest Room">Guest Room</SelectItem>
                  <SelectItem value="Kids Room">Kids Room</SelectItem>
                  <SelectItem value="Balcony">Balcony</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="designStyle">Design Style <span className="text-destructive">*</span></Label>
              <Select
                value={designStyle}
                onValueChange={setDesignStyle}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select design style..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Modern">Modern</SelectItem>
                  <SelectItem value="Contemporary">Contemporary</SelectItem>
                  <SelectItem value="Minimalist">Minimalist</SelectItem>
                  <SelectItem value="Scandinavian">Scandinavian</SelectItem>
                  <SelectItem value="Industrial">Industrial</SelectItem>
                  <SelectItem value="Bohemian">Bohemian</SelectItem>
                  <SelectItem value="Traditional">Traditional</SelectItem>
                  <SelectItem value="Rustic">Rustic</SelectItem>
                  <SelectItem value="Coastal">Coastal</SelectItem>
                  <SelectItem value="Mediterranean">Mediterranean</SelectItem>
                  <SelectItem value="Japandi">Japandi</SelectItem>
                  <SelectItem value="Mid-Century Modern">Mid-Century Modern</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="imageGen">Image <span className="text-destructive">*</span></Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageSelect}
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className=" rounded-xl"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {image ? "Change Image" : "Upload Image"}
                </Button>
                {image && (
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
                    <img src={image} alt="Preview" className="w-full h-full object-cover" />
                    <button
                      onClick={() => {
                        setImage(null);
                        setImageFile(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                      className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded-full p-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              {!image && (
                <p className="text-xs text-muted-foreground">Image is required for room generation</p>
              )}
            </div>
          </div>
        );
      case "design-with-inputs":
        return schema ? (
          <div className="mt-4">
            {/* Render dynamic form based on schema */}
            <DynamicForm
              schema={schema}
              handleSubmit={(data) => {
                setDynamicFormData(data);
                onFormSubmit?.({
                  cardType: selectedCardType,
                  text: searchQuery.trim() || "",
                  image: image || undefined,
                  voice: voiceBlob || undefined,
                  dynamicformData: data,
                });
                setIsExpanded(false)

                // You can handle the submitted data here if needed
                console.log("Dynamic Form Data:", data);
              }}
            />
          </div>
        ) : null;
      case "innova-design":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="innovaImage">Image <span className="text-destructive">*</span></Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,.ifc,.glb"
                multiple
                onChange={handleImageSelect}
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {image ? "Change Image" : "Upload Image"}
                </Button>
                {image && (
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
                    <img src={image} alt="Preview" className="w-full h-full object-cover" />
                    <button
                      onClick={() => {
                        setImage(null);
                        setImageFile(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                      className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded-full p-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              {!image && (
                <p className="text-xs text-muted-foreground">Please upload an image to proceed to annotation</p>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      {/* Backdrop */}
      {isExpanded && (
        <div 
          className="fixed inset-0 bg-black/20 animate-fade-in z-40"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* Expanded Search Sheet - Only shown when filter icon is clicked */}
      {isExpanded && (
        <div className="fixed inset-x-0 bottom-0 z-50 animate-slide-up">
          <div className="glass shadow-glass rounded-t-3xl p-6  max-h-[90vh] overflow-y-auto">
            {/* Close Button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 rounded-full"
              onClick={() => setIsExpanded(false)}
            >
              <X className="h-5 w-5" />
            </Button>

            {/* Card Type Selection */}
            {/* <div className="mb-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">Select Card Type</h3>
              <Select
                value={selectedCardType || ""}
                onValueChange={(value) => setSelectedCardType(value as CardType)}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Choose a card type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="moodboard">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span>Moodboard</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="room-layout">
                    <div className="flex items-center gap-2">
                      <Layout className="h-4 w-4 text-primary" />
                      <span>Room Layout</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="furniture-bundle">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-primary" />
                      <span>Furniture Bundle</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="boq">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      <span>BOQ</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div> */}

            {/* Card-specific form fields */}
            {selectedCardType && (
              <div className="mb-1">
                <h3 className="text-sm font-semibold text-foreground mb-4">
                  Additional Details for {getCardTypeLabel(selectedCardType)}
                </h3>
                {renderCardSpecificFields()}
                {/* Proceed Button */}
                {selectedCardType !== "design-with-inputs" && selectedCardType !== "innova-design" && (
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={handleFormSubmit}
                    disabled={isSubmitting}
                    className="rounded-xl bg-primary hover:bg-primary/90"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        { "Proceed"}
                      </>
                    )}
                  </Button>
                </div>)}
              </div>
            )}

            {/* Recent Searches */}
            {!selectedCardType && recentSearches.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Recent</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentSearches.map((search, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSearchQuery(search);
                        onSearch(search);
                        setIsExpanded(false);
                      }}
                      className="px-4 py-2 bg-secondary rounded-full text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-smooth"
                    >
                      {search}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Trending */}
            {!selectedCardType && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Trending</h3>
                </div>
                <div className="space-y-2">
                  {trendingPrompts.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSearchQuery(prompt);
                        onSearch(prompt);
                        setIsExpanded(false);
                      }}
                      className="w-full text-left px-4 py-3 bg-card rounded-xl hover:bg-secondary transition-smooth flex items-center justify-between group"
                    >
                      <span className="text-sm font-medium">{prompt}</span>
                      <Search className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-smooth" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={showInnovaSelection} onOpenChange={setShowInnovaSelection}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Select Design Mode</DialogTitle>
            <DialogDescription>
              Choose how you would like to proceed with your room design.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-4 justify-center py-4">
             <Button
              onClick={() => {
                navigate("/3d-model", { state: { createLayout: true } });
                setShowInnovaSelection(false);
              }}
              variant="outline"
              className="flex-1 h-32 flex flex-col gap-2 rounded-xl border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <Layout className="h-8 w-8 text-primary" />
              <div className="font-semibold">Create Layout</div>
              <div className="text-xs text-muted-foreground">Draw Layout
           </div>
            </Button>
            <Button
              onClick={() => {
                setInnovaMode("2D");
                setShowInnovaSelection(false);
                setIsExpanded(true);
                setTimeout(() => fileInputRef.current?.click(), 100);
              }}
              variant="outline"
              className="flex-1 h-32 flex flex-col gap-2 rounded-xl border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <Layout className="h-8 w-8 text-primary" />
              <div className="font-semibold">Room Design</div>
              <div className="text-xs text-muted-foreground">Upload Image/PDF</div>
            </Button>
            <Button
              onClick={() => {
                setInnovaMode("3D");
                setShowInnovaSelection(false);
                setTimeout(() => fileInputRef.current?.click(), 100);
              }}
              variant="outline"
              className="flex-1 h-32 flex flex-col gap-2 rounded-xl border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <Box className="h-8 w-8 text-primary" />
              <div className="font-semibold">Room Design 3D</div>
              <div className="text-xs text-muted-foreground">Upload IFC Model</div>
            </Button>
              <Button
              onClick={() => {
                setInnovaMode("2D-3D");
                setShowInnovaSelection(false);
                setTimeout(() => fileInputRef.current?.click(), 100);
              }}
              variant="outline"
              className="flex-1 h-32 flex flex-col gap-2 rounded-xl border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <Box className="h-8 w-8 text-primary" />
              <div className="font-semibold">2D to 3D Generation</div>
              <div className="text-xs text-muted-foreground">Upload Image/PDF to 
                <br/>generate 3D Model</div>
            </Button>
           
          </div>
        </DialogContent>
      </Dialog>

      {/* Collapsed Search Dock */}
      <div className="fixed bottom-0 inset-x-0 z-40 p-4 pb-safe">
        <div className="flex flex-col gap-2 mx-auto max-w-md">
          {/* Thumbnails/Previews above the input */}
          {(image || voiceBlob) && (
            <div className="flex items-center gap-2 px-4">
              {image && (
                <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-border">
                  <img src={image} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    onClick={() => {
                      setImage(null);
                      setImageFile(null);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {voiceBlob && !isRecording && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-lg border border-border">
                  <Mic className="h-4 w-4 text-primary" />
                  <span className="text-xs text-foreground">
                    {Math.round(voiceBlob.size / 1024)} KB
                  </span>
                  <button
                    onClick={() => setVoiceBlob(null)}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Main Search Bar */}
          <div className="flex items-center gap-3">
            {/* Add Button with Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  className="h-12 w-12 rounded-full bg-primary hover:bg-primary/90 shadow-elevated flex-shrink-0"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="rounded-xl min-w-[200px]">
                {/* Interior Image Generation */}
                <DropdownMenuItem
                  onClick={() => handleCardTypeSelect("furniture-bundle")}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Package className="h-4 w-4 text-primary" />
                  <span>Inspiration Search</span>
                </DropdownMenuItem>

                {/* Room Generation */}
                <DropdownMenuItem
                  onClick={() => {
                    handleCardTypeSelect("room-generation");
                    setIsExpanded(true);
                  }}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Layout className="h-4 w-4 text-primary" />
                  <span>Design Your Room</span>
                </DropdownMenuItem>

                {/* Floorplan Room Generation */}
                <DropdownMenuItem
                  onClick={() => handleCardTypeSelect("floorplan-room-generation")}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>Floorplan Search</span>
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => handleCardTypeSelect("design-with-inputs")}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>Design With Inputs</span>
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => handleCardTypeSelect("innova-design")}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>Innova Design</span>
                </DropdownMenuItem>



                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="flex items-center gap-2 cursor-pointer">
                    <span>Others</span>
                  </DropdownMenuSubTrigger>

                  <DropdownMenuSubContent className="min-w-[150px] md:min-w-[220px]">
                    <DropdownMenuItem
                      onClick={() => {
                        handleCardTypeSelect("moodboard");
                      }}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span>Moodboard</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        handleCardTypeSelect("room-layout");
                      }}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Layout className="h-4 w-4 text-primary" />
                      <span>Room Layout</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        handleCardTypeSelect("boq");
                      }}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <FileText className="h-4 w-4 text-primary" />
                      <span>BOQ</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Search Input */}
            <div className="flex-1 glass shadow-elevated rounded-full p-2 flex items-center gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search designs, styles, products..."
                className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
              />
              
              {/* Action Buttons */}
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={selectedCardType === "innova-design" ? "image/*,application/pdf,.ifc,.glb" : "image/*"}
                  onChange={handleImageSelect}
                  className="hidden"
                />
                {searchQuery.trim()=="" &&<Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-4 w-4" />
                </Button>}
                {searchQuery.trim()=="" &&<Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 rounded-full ${isRecording ? "bg-destructive/10 text-destructive" : ""}`}
                  onClick={handleVoiceRecord}
                >
                  <Mic className={`h-4 w-4 ${isRecording ? "animate-pulse" : ""}`} />
                </Button>}    
                {searchQuery.trim()=="" &&<Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setIsExpanded(true)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>}
                { (searchQuery.trim() || image || voiceBlob) && (
                  <Button
                    size="icon"
                    className="h-8 w-8 rounded-full bg-primary hover:bg-primary/90"
                    onClick={handleSearch}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
