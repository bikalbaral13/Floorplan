import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders, getDataSpecificById, updateServiceByEntity } from "@/api/action";
import { floorplanRoomGenerationEntityId, furnitureBundleEntityId } from "@/lib/const";
import { parseJsonStringFields } from "@/lib/utils";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import LoadingPopup from "@/components/loadingpopup";

const getImageUrlFullView = (url: string): string => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `https://cdn.abyat.com/${url}`;
};

export default function FurnitureBundleGeneration() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [currentData, setCurrentData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [bundleData, setBundleData] = useState<any[]>([]);
  const [showUploadedImage, setShowUploadedImage] = useState(false);
  const [showOriginalImageDialog, setShowOriginalImageDialog] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const type = "floorplan-room-generation";
  const roomId = searchParams.get("roomId");
  const planId = searchParams.get("planId");

  useEffect(() => {
    const loadData = async () => {
      if (!id) {
        toast({
          title: "Error",
          description: "Missing card ID",
          variant: "destructive",
        });
        
        return;
      }
      

      setIsLoading(true);
      try {
        const entityId = type === "floorplan-room-generation" 
          ? floorplanRoomGenerationEntityId 
          : furnitureBundleEntityId;
        
        const result = await getDataSpecificById(entityId, id);
        
        if (result.success && result.data) {
          const parsedData = parseJsonStringFields(result.data as Record<string, unknown>);
          
          if (type === "floorplan-room-generation" && planId) {
            const floorplanArray = Array.isArray(parsedData.floorplan) 
              ? parsedData.floorplan 
              : typeof parsedData.floorplan === 'string' 
                ? JSON.parse(parsedData.floorplan) 
                : [];
            const floorplan = floorplanArray.find(
              (plan: any) => String(plan._id) === String(planId)
            );
            if (floorplan?.data) {
              const roomDetails = floorplan.data.roomDetails || [];
              const room = roomDetails.find(
                (r: any) => String(r.id) === String(roomId)
              );
              if(room?.versions && Array.isArray(room?.versions) && (room?.versions as unknown[])?.length > 0){
                navigate(-1);
                return;
              }

              if (room) {
                setCurrentData(room);
                setShowUploadedImage(true);
              } else {
                setCurrentData(parsedData);
              }
            } else {
              setCurrentData(parsedData);
            }
          } else {
            setCurrentData(parsedData);
            setShowUploadedImage(type === "floorplan-room-generation");
          }
        } else {
          throw new Error(result.message || "Failed to load data");
        }
      } catch (error) {
        console.error("Error loading data:", error);
        toast({
          title: "Load Error",
          description: error instanceof Error ? error.message : "Failed to load data",
          variant: "destructive",
        });
       
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [id, type, planId, roomId, navigate, toast]);
  const [loadingPercent, setLoadingPercent] = useState(0);
const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
  if (!showLoader) return;
if(loadingPercent < 90){
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


  const generateHandle = async () => {
    if (!currentData) return;

    try {
      setIsGenerating(true);
      setShowLoader(true);
      const result = await fetch(
        `${import.meta.env.VITE_API_URL}/api/user/agent/start/693176306b5fd1fb51c76a36`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            files: currentData.imagee + "," + currentData.image,
          }),
        }
      );

      const data = await result.json();
      setLoadingPercent(100);
      setTimeout(() => {
        setShowLoader(false);
        setLoadingPercent(0);
      }, 500);
      const urlData = data?.workflowlog?.tasks?.[data?.workflowlog?.tasks?.length - 1]?.result?.data;
      console.log("urlData", urlData);

      if (!urlData) {
        toast({
          title: "Generation Error",
          description: "No images were generated",
          variant: "destructive",
        });
        return;
      }

      const newUrls: string[] = Array.isArray(urlData.imageUrl)
        ? urlData.imageUrl
        : [urlData.imageUrl].filter((u: string) => typeof u === "string");
        setBundleData((prev) => [...prev,urlData]);

      if (newUrls.length === 0) {
        toast({
          title: "Generation Error",
          description: "No valid image URLs returned",
          variant: "destructive",
        });
        return;
      }

      setGeneratedImages((prev) => [...prev, ...newUrls]);
      setCurrentImageIndex(0); // Reset to first image when new ones are generated
      handlesavegeneratedimage(urlData);
      toast({
        title: "Success",
        description: `${newUrls.length} image(s) generated successfully`,
      });
    } catch (error) {
      console.error("Error in generateHandle", error);
      toast({
        title: "Generation Error",
        description: error instanceof Error ? error.message : "Failed to generate images",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handlesavegeneratedimage = async (versionData: any) => {
    if (!currentData || !id) return;

    try {
      setIsGenerating(true);
    //   const result = await fetch(
    //     `${import.meta.env.VITE_API_URL}/api/user/agent/start/692ebebd48fe8962dff7cda4`,
    //     {
    //       method: "POST",
    //       headers: {
    //         "Content-Type": "application/json",
    //         ...getAuthHeaders(),
    //       },
    //       body: JSON.stringify({
    //         files: url,
    //         file: currentData.image,
    //       }),
    //     }
    //   );

    //   const data = await result.json();
    //   const versionData = data?.workflowlog?.tasks?.[0]?.result?.data;
    
    // Find the bundle data that matches the selected image URL
    // const versionData = bundleData.find((bundle: any) => {
    //   if (Array.isArray(bundle.imageUrl)) {
    //     return bundle.imageUrl.includes(url);
    //   }
    //   return bundle.imageUrl === url;
    // });

      if (!versionData) {
        toast({
          title: "Save Error",
          description: "Failed to process image",
          variant: "destructive",
        });
        return;
      }

      if (type === "floorplan-room-generation") {
        let completeData;
        try {
          const fetchedResult = await getDataSpecificById(floorplanRoomGenerationEntityId, id);
          if (fetchedResult.success && fetchedResult.data) {
            const parsedData = parseJsonStringFields(fetchedResult.data as Record<string, unknown>);
            completeData = parsedData;
          }
        } catch (fetchError) {
          console.warn("Failed to fetch complete data:", fetchError);
        }

        if (!completeData) {
          completeData = parseJsonStringFields(currentData as Record<string, unknown>);
        }

        const formData = new FormData();
        let floorplanArray = completeData?.floorplan || [];

        if (typeof floorplanArray === "string") {
          try {
            floorplanArray = JSON.parse(floorplanArray);
          } catch {
            floorplanArray = [];
          }
        }

        if (!Array.isArray(floorplanArray)) {
          floorplanArray = [];
        }

        const planIdToMatch = planId || "";
        const floorplanIndex = floorplanArray.findIndex((floorplan: any) => {
          const planId = floorplan._id || floorplan.id;
          return planId !== undefined && String(planId) === String(planIdToMatch);
        });

        if (floorplanIndex === -1) {
          throw new Error(`Floorplan with id ${planIdToMatch} not found`);
        }

        const targetFloorplan = floorplanArray[floorplanIndex];
        if (!targetFloorplan.data) {
          targetFloorplan.data = {};
        }

        let roomdetails = targetFloorplan.data?.roomDetails || [];
        if (typeof roomdetails === "string") {
          try {
            roomdetails = JSON.parse(roomdetails);
          } catch {
            roomdetails = [];
          }
        }

        if (!Array.isArray(roomdetails)) {
          roomdetails = [];
        }

        const roomIdToMatch = roomId || "";
        const roomIndex = roomdetails.findIndex((room: any) => {
          return room.id !== undefined && String(room.id) === String(roomIdToMatch);
        });

        if (roomIndex === -1) {
          throw new Error(`Room with id ${roomIdToMatch} not found`);
        }

        const currentRoom = roomdetails[roomIndex];
        let roomVersions = [];
        if (Array.isArray(currentRoom?.versions)) {
          roomVersions = currentRoom.versions;
        } else if (typeof currentRoom?.versions === "string") {
          try {
            roomVersions = JSON.parse(currentRoom.versions);
          } catch {
            roomVersions = [];
          }
        }

        const updatedRoomVersions = [
          ...roomVersions,
          {
            id: versionData.id,
            title: versionData.title,
            version: versionData.version,
            timestamp: versionData.timestamp,
            imageUrl: versionData.imageUrl,
            tags: versionData.tags,
            bundleInfo: versionData.bundleInfo,
            totalPrice: versionData.totalPrice,
            items: versionData.items,
          },
        ];

        const updatedRoom = {
          ...currentRoom,
          versions: updatedRoomVersions,
        };

        const updatedRoomdetails = [...roomdetails];
        updatedRoomdetails[roomIndex] = updatedRoom;

        const updatedFloorplan = {
          ...targetFloorplan,
          data: {
            ...targetFloorplan.data,
            roomDetails: updatedRoomdetails,
          },
        };

        const updatedFloorplanArray = [...floorplanArray];
        updatedFloorplanArray[floorplanIndex] = updatedFloorplan;

        Object.entries(completeData).forEach(([key, value]) => {
          if (key === "roomDetails" || key === "versions" || key === "data" || key === "floorplan" || key === "_id") return;
          if (value !== null && value !== undefined) {
            if (typeof value === 'object' && !(value instanceof File) && !(value instanceof Blob)) {
              formData.append(key, JSON.stringify(value));
            } else {
              formData.append(key, String(value));
            }
          }
        });

        formData.append("floorplan", JSON.stringify(updatedFloorplanArray));

        const updatedDataResult = await updateServiceByEntity(
          floorplanRoomGenerationEntityId,
          id,
          formData
        );

        if (updatedDataResult) {
          setGeneratedImages([]);
          toast({
            title: "Success",
            description: "Version saved successfully",
          });
          
          // Navigate to the detail page
          const navPath = `/card/${type}/${id}${planId ? `?planId=${planId}` : ''}${roomId ? `${planId ? '&' : '?'}roomId=${roomId}` : ''}`;
          navigate(navPath);
        } else {
          throw new Error("Failed to save version");
        }
      }
    } catch (error) {
      console.error("Error in handlesavegeneratedimage", error);
      toast({
        title: "Save Error",
        description: error instanceof Error ? error.message : "Failed to save image",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Memoize image URL calculations to prevent unnecessary recalculations
  // These hooks must be called before any early returns
  const displayImage = useMemo(() => {
    if (!currentData) return null;
    return showUploadedImage && currentData.image 
      ? currentData.image 
      : currentData.imageUrl;
  }, [showUploadedImage, currentData?.image, currentData?.imageUrl]);

  const originalImageUrl = useMemo(() => {
    return displayImage ? getImageUrlFullView(displayImage) : null;
  }, [displayImage]);

  // Memoize mainDisplayImages to prevent unnecessary re-renders
  const hasGeneratedImages = generatedImages.length > 0;
  const mainDisplayImages = useMemo(() => {
    if (hasGeneratedImages) {
      return generatedImages;
    }
    return originalImageUrl ? [originalImageUrl] : [];
  }, [hasGeneratedImages, generatedImages, originalImageUrl]);

  // Preload the first image for faster rendering
  useEffect(() => {
    if (mainDisplayImages.length > 0 && mainDisplayImages[0]) {
      const img = new Image();
      img.src = mainDisplayImages[0];
    }
  }, [mainDisplayImages]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!currentData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">No data found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 glass border-b border-border/50 backdrop-blur-xl">
        <div className="px-4 py-3 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold ">Floorplan Room Generation</h1>
          {/* Original Image Thumbnail in Header */}
          {originalImageUrl && generatedImages.length> 0 && (
            <button
              onClick={() => setShowOriginalImageDialog(true)}
              className="relative w-12 h-12 rounded-lg overflow-hidden border-2 border-border hover:border-primary transition-colors cursor-pointer flex-shrink-0"
              title="View original image"
            >
              <img
                src={originalImageUrl}
                alt="Original"
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="flex flex-col gap-6">
          {/* Main Image Display - Shows generated images if available, otherwise original */}
          <div className="w-full relative rounded-xl overflow-hidden bg-muted/30 border border-border">
            {mainDisplayImages.length > 0 ? (
              mainDisplayImages.length === 1 ? (
                // Single image display
                <div className="relative w-full">
                  <img
                    src={mainDisplayImages[0]}
                    alt={hasGeneratedImages ? "Generated image" : "Room image"}
                    className="w-full h-auto max-h-[70vh] object-contain mx-auto"
                    loading="eager"
                    decoding="async"
                  />
                  {hasGeneratedImages && (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute top-4 right-4 rounded-full h-10 w-10 bg-background/90 hover:bg-background z-10 shadow-lg"
                      // onClick={() => handlesavegeneratedimage(generatedImages[0])}
                      disabled={isGenerating}
                    >
                      {isGenerating ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Save className="w-5 h-5" />
                      )}
                    </Button>
                  )}
                </div>
              ) : (
                // Multiple images - Horizontal carousel
                <Carousel 
                  className="w-full"
                  opts={{
                    align: "center",
                    loop: true,
                  }}
                  setApi={(api) => {
                    if (!api) return;
                    
                    // Set initial index
                    setCurrentImageIndex(api.selectedScrollSnap());
                    
                    // Listen for slide changes
                    api.on("select", () => {
                      setCurrentImageIndex(api.selectedScrollSnap());
                    });
                  }}
                >
                  <CarouselContent className="-ml-2 md:-ml-4">
                    {mainDisplayImages.map((url, index) => (
                      <CarouselItem key={`${url}-${index}`} className="pl-2 md:pl-4 basis-full">
                        <div className="relative w-full">
                          <img
                            src={url}
                            alt={hasGeneratedImages ? `Generated ${index + 1}` : "Room image"}
                            className="w-full h-auto max-h-[70vh] object-contain mx-auto"
                            loading={index === 0 ? "eager" : "lazy"}
                            decoding="async"
                          />
                          {hasGeneratedImages && (
                            <Button
                              variant="secondary"
                              size="icon"
                              className="absolute top-4 right-4 rounded-full h-10 w-10 bg-background/90 hover:bg-background z-10 shadow-lg"
                              // onClick={() => handlesavegeneratedimage(url)}
                              disabled={isGenerating}
                            >
                              {isGenerating ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <Save className="w-5 h-5" />
                              )}
                            </Button>
                          )}
                        </div>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  {mainDisplayImages.length > 1 && (
                    <>
                      <CarouselPrevious className="left-4" />
                      <CarouselNext className="right-4" />
                    </>
                  )}
                </Carousel>
              )
            ) : (
              <div className="w-full h-[70vh] flex items-center justify-center text-muted-foreground">
                No image available
              </div>
            )}
          </div>

          {/* Image counter for generated images */}
          {/* {hasGeneratedImages && generatedImages.length > 1 && (
            <div className="text-center text-sm text-muted-foreground">
              Image {currentImageIndex + 1} of {generatedImages.length}
            </div>
          )} */}

          {/* Action Buttons */}
          <div className="flex gap-3 justify-center">
            {generatedImages.length === 0 && <Button
              variant="default"
              size="lg"
              onClick={generateHandle}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Generate 3D
                </>
              )}
            </Button>
            }
            {generatedImages.length > 0 && <Button
              variant="outline"
              size="lg"
              onClick={generateHandle}
              disabled={isGenerating || generatedImages.length === 0}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Regenerating...
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5 mr-2" />
                  Regeneration
                </>
              )}
            </Button>
            }
          </div>
        </div>
      </div>
      <LoadingPopup show={showLoader} progress={loadingPercent} />

      {/* Original Image Dialog */}
      <Dialog open={showOriginalImageDialog} onOpenChange={setShowOriginalImageDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0">
          {originalImageUrl && (
            <img
              src={originalImageUrl}
              alt="Original room image"
              className="w-full h-auto max-h-[90vh] object-contain rounded-lg"
              loading="eager"
              decoding="async"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

