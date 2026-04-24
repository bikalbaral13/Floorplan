  import { useEffect, useState } from "react";
  import { useParams, useNavigate } from "react-router-dom";
  import { ArrowLeft, Loader2, Ruler, Package, FileText, Sparkles, CheckCircle2 } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { MoodboardCard } from "@/components/chat/MoodboardCard";
  import { FurnitureBundleCard } from "@/components/chat/FurnitureBundleCard";
  import { BOQCard } from "@/components/chat/BOQCard";
  import { RoomLayoutCard } from "@/components/chat/RoomLayoutCard";
  import { getDataSpecificById, generateRoomLayoutCard, generateFurnitureBundleCard, generateBOQCard, AgentResponse, postServiceByEntity, generateFurnitureBundleCardByInspiration, generateRoomGenerationCard, getServiceByEntity, updateServiceByEntity } from "@/api/action";
  import { moodboardEntityId, roomLayoutEntityId, furnitureBundleEntityId, boqEntityId, queryEntityId, roomGenerationEntityId, floorplanRoomGenerationEntityId } from "@/lib/const";
  import { useToast } from "@/hooks/use-toast";
  import { parseJsonStringFields } from "@/lib/utils";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
  } from "@/components/ui/dialog";
import { RoomGenerationCard } from "@/components/chat/RoomGenerationCard";
import { FloorplanRoomGenerationCard } from "@/components/chat/FloorplanRoomGenerationCard";

  type CardType = "moodboard" | "furniture-bundle" | "boq" | "room-layout" | "room-generation" | "floorplan-room-generation";

  export default function CardDetail() {
      const { type, id } = useParams<{ type: CardType; id: string }>();
    const searchParams = new URLSearchParams(window.location.search);
      const inspirationId = searchParams.get('inspirationId');
    const navigate = useNavigate();
    const { toast } = useToast();
    const [cardData, setCardData] = useState<Record<string, unknown> | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showProceedDialog, setShowProceedDialog] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedCardIds, setGeneratedCardIds] = useState<Record<string, string>>({});
    const [loadAgain, setLoadAgain] = useState(false);

    // Get entity ID based on card type
    const getEntityIdByCardType = (cardType: CardType): string => {
      switch (cardType) {
        case "moodboard":
          return moodboardEntityId;
        case "room-layout":
          return roomLayoutEntityId;
        case "furniture-bundle":
          return furnitureBundleEntityId;
        case "boq":
          return boqEntityId;
        case "room-generation":
          return roomGenerationEntityId;
        case "floorplan-room-generation":
          return floorplanRoomGenerationEntityId;
        default:
          return moodboardEntityId;
      }
    };

    useEffect(() => {
      const loadCardData = async () => {
        if (!id || !type) {
          toast({
            title: "Invalid Card",
            description: "Card ID or type is missing",
            variant: "destructive",
          });
          navigate("/");
          return;
        }

        setIsLoading(true);
        try {
          // Check if data is stored in sessionStorage (for hardcoded bundles)
          const storedDataKey = `${type}-${id}`;
          const storedData = sessionStorage.getItem(storedDataKey);
          
          if (storedData) {
            // Use stored data (for hardcoded bundles)
            const parsedData = JSON.parse(storedData);
            console.log("CardDetail - Using stored data:", parsedData);
            setCardData(parsedData);
            // Clear the stored data after use
            sessionStorage.removeItem(storedDataKey);
          } else {
            console.log("CardDetail - No stored data, fetching from API");
            // Fetch from API
            const entityId = getEntityIdByCardType(type);
            const result = await getDataSpecificById(entityId, id);
            
            if (result.success && result.data) {
              // Transform API response to card data format
              const apiData = result.data as Record<string, unknown>;
              
              const transformedData: Record<string, unknown> = {
                id:  apiData._id || id,
                ...apiData,
              };

              // Parse all JSON string fields before setting card data
              let parsedData:any = parseJsonStringFields(transformedData);
              console.log("CardDetail - Parsed data:", parsedData);
              let queryid: string;
              if (parsedData.queryId) {
                queryid = parsedData.queryId as string;
              }
              if(parsedData.referenceType && parsedData.referenceId) {
                setGeneratedCardIds({
                  [parsedData.referenceType as CardType]: parsedData.referenceId as string,
                });
                }
                if (inspirationId) {
                  let queryy: any;
                  let processed;
               
                  (parsedData.data as any || parsedData).inspirations.forEach((inspiration: any) => {
                      if (inspiration.id === inspirationId) {
                        queryy = inspiration;
                        processed = inspiration.processed;
                        console.log("Found inspiration for processing:", inspiration);
                        
                      }
                     
                  });
                  if (queryy && !processed) {

                  const result:any = await generateFurnitureBundleCardByInspiration({
                      userId: getUserId(),
                      query: queryy,
                    });
                      console.log("Furniture bundle card by inspiration:", result);
                    parsedData = { ...(result as any)?.workflowlog?.tasks?.[0]?.result?.data, processed: true };
                    let completeData: any;
                    if (parsedData) {
                      const getdata = await getDataSpecificById(furnitureBundleEntityId, id );
                      if (getdata.success && getdata.data) {
                        const parsefield=["data"]
                        const parseData = parseJsonStringFields(getdata.data as Record<string, unknown>, parsefield);
                        console.log("Fetched existing furniture bundle data:", parseData);

                        // Merge fetched data with current data, prioritizing current data but filling missing fields
                        completeData = {
                          ...parseData,
                          // Current data takes precedence
                        };
                      }
                      const addd = completeData?.data?.inspirations || completeData?.inspirations || [];
                      let inspi = addd.map((inspiration: any) => { 
                        if (inspiration.id === inspirationId) {
                          return { ...parsedData , processed: true };
                        }
                        return inspiration;
                      });
                      const { data,_id,success, ...rest } = completeData;

                      const finalPayload = {
                        ...rest,
                        inspirations: inspi,
                      };

                      console.log("Payload to send:", finalPayload);

                      const saveResponse = await updateServiceByEntity(
                        furnitureBundleEntityId,
                        id,
                        finalPayload   // 👈 send JSON object
                      );
                 
                      console.log("Updated furniture bundle after inspiration processing:", saveResponse);
                      parsedData = {  ...parsedData, ...finalPayload };
                    }
                  } else {
                    parsedData = {  ...parsedData, ...queryy };
                  }
                  

                    
                    console.log("Furniture bundle card by inspiration:", parsedData.data);
              }
              if (type === "floorplan-room-generation") {
                const passedData = parsedData.floorplan.find(
                  (plan: any) => plan._id === searchParams.get("planId")
                );
                console.log("parsedDataaa", passedData);
                parsedData = {  ...passedData.data };
                console.log("parsedDataaa", parsedData);
              }
              if (queryid) {
                const queryResult = await getDataSpecificById(queryEntityId, queryid);
                if (queryResult.success && queryResult.data) {
                  const queryData = queryResult.data as Record<string, unknown>;
                  parsedData = { ...parsedData, ...queryData };
                  console.log("Parsed data with query:", parsedData);
                }
              }
            

                console.log("CardDetail - Parsed data:", parsedData);
              setCardData(parsedData);
            } else {
              throw new Error(result.message || "Failed to load card data");
            }
          }
        } catch (error) {
          console.error("Error loading card:", error);
          toast({
            title: "Load Error",
            description: error instanceof Error ? error.message : "Failed to load card data",
            variant: "destructive",
          });
          navigate("/");
        } finally {
          setIsLoading(false);
        }
      };

      loadCardData();
    }, [id, type, navigate, toast, inspirationId]);


    

    // Get userId from localStorage
    const getUserId = () => {
      return localStorage.getItem("userId") || "681c42efbad3787228013937";
    };

    // Handle proceed to next - show options dialog
    const handleProceedNext = () => {
      setShowProceedDialog(true);
    };

    // Helper function to save card data to entity and navigate back
    const saveCardAndNavigate = async (cardType: CardType, savedEntityId: string, allGeneratedIds: Record<string, string> = {}) => {
      const params = new URLSearchParams();
      
      // Add current card ID (the card we're viewing)
      if (type === "moodboard" && id) {
        params.set("mood", id);
      } else if (type === "room-layout" && id) {
        params.set("layout", id);
      } else if (type === "furniture-bundle" && id) {
        params.set("complete", id);
      } else if (type === "boq" && id) {
        params.set("boq", id);
      } else if (type === "room-generation" && id) {
        params.set("room-generation", id);
      } else if (type === "floorplan-room-generation" && id) {
        params.set("floorplan-room-generation", id);
      }

      // Add all previously generated card IDs
      if (allGeneratedIds["room-layout"]) {
        params.set("layout", allGeneratedIds["room-layout"]);
      }
      if (allGeneratedIds["furniture-bundle"]) {
        params.set("complete", allGeneratedIds["furniture-bundle"]);
      }
      if (allGeneratedIds["boq"]) {
        params.set("boq", allGeneratedIds["boq"]);
      }

      // Add the newly saved entity ID based on card type (this will overwrite if exists, which is correct)
      switch (cardType) {
        case "moodboard":
          params.set("mood", savedEntityId);
          break;
        case "room-layout":
          params.set("layout", savedEntityId);
          break;
        case "furniture-bundle":
          params.set("complete", savedEntityId);
          break;
        case "boq":
          params.set("boq", savedEntityId);
          break;
        case "room-generation":
          params.set("room-generation", savedEntityId);
          break;
        case "floorplan-room-generation":
          params.set("floorplan-room-generation", savedEntityId);
          break;
      }

      // Navigate back with query params (equivalent to navigate(-1) but with updated params)
        navigate(`/?${params.toString()}`);
    };

    // Generate a specific card type


    const generateCard = async (targetType: CardType) => {
      if (!cardData || !type || !id) return;

      setIsGenerating(true);
      try {
        const userId = getUserId();
        const query = (cardData.query as string) || (cardData.title as string) || "";
        
        let result: AgentResponse;

        switch (targetType) {
          case "room-layout":
            result = await generateRoomLayoutCard({
              userId,
              query,
              previousCardData: cardData,
            });
            break;
          case "furniture-bundle":
            result = await generateFurnitureBundleCard({
              userId,
              query,
              previousCardData: cardData,
            });
            break;
          case "boq":
            result = await generateBOQCard({
              userId,
              query,
              previousCardData: cardData,
            });
            break;
          case "room-generation":
            result = await generateRoomGenerationCard({
              userId,
              query,
              
            });
            break;
          case "floorplan-room-generation":
            result = await getServiceByEntity("6929855f48fe8962dff727f8", {
              field: "type",
              value: query.toLowerCase(),
            });
            break;
        default:
            throw new Error(`Unsupported card type: ${targetType}`);
        }

        if (targetType === "floorplan-room-generation") {
          const responseData = result[0] as unknown;
          const parsedData: any = parseJsonStringFields(responseData as Record<string, unknown>);
          const entityId = getEntityIdByCardType(targetType);
          const entityFormData = new FormData();
          Object.entries(parsedData).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
              entityFormData.append(key, String(value));
            }
          });
          if(cardData.queryId) {
            entityFormData.append("queryId", cardData.queryId as string);
          }
          if(type) {
            entityFormData.append("referenceType", type);
          }
          if(id) {
            entityFormData.append("referenceId", id);
          }
          const saveResponse = await postServiceByEntity(entityId, entityFormData);
          const savedEntityId = saveResponse._id || saveResponse.id;
          if (!savedEntityId) {
            throw new Error("Failed to save card data to entity");
          }
          const updatedGeneratedIds = { ...generatedCardIds, [targetType]: savedEntityId };
          setGeneratedCardIds(updatedGeneratedIds); 
          toast({
            title: "Success",
            description: `${targetType} saved successfully`,
          });
          await saveCardAndNavigate(targetType, savedEntityId, updatedGeneratedIds);
          return;
        }
       // Transform agent response to card data
        const agentResponse = result as {
          workflowlog?: {
            tasks?: Array<{
              result?: {
                data?: Record<string, unknown>;
              };
            }>;
          };
          tasks?: Array<{
            result?: {
              data?: Record<string, unknown>;
            };
          }>;
        };
        
        // Extract cardData from agent response
        const responseCardData = agentResponse?.workflowlog?.tasks?.[0]?.result?.data || 
                                agentResponse?.tasks?.[0]?.result?.data || 
                                {} as Record<string, unknown>;

        if (!responseCardData || Object.keys(responseCardData).length === 0) {
          throw new Error("Failed to extract card data from response");
        }

        // Save cardData to entity using postServiceByEntity
        const entityId = getEntityIdByCardType(targetType);
        const entityFormData = new FormData();
        
        // Append all cardData fields to formData
        Object.entries(responseCardData).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            if (typeof value === 'object' && !(value instanceof File) && !(value instanceof Blob)) {
              entityFormData.append(key, JSON.stringify(value));
            } else if (value instanceof File || value instanceof Blob) {
              entityFormData.append(key, value);
            } else {
              entityFormData.append(key, String(value));
            }
          }
        });

        // Add queryId to card entity (current card's id)
        if (id) {
          entityFormData.append("referenceId", id);
        }
        if(cardData.queryId) {
          entityFormData.append("queryId", cardData.queryId as string);
        }

        // Add reference type (current card type)
        if (type) {
          entityFormData.append("referenceType", type);
        }

        // Save to entity and get the stored _id
        const saveResponse = await postServiceByEntity(entityId, entityFormData);
        const savedEntityId = saveResponse._id || saveResponse.id;

        if (!savedEntityId) {
          throw new Error("Failed to save card data to entity");
        }

        // Store saved entity ID
        const updatedGeneratedIds = { ...generatedCardIds, [targetType]: savedEntityId };
        setGeneratedCardIds(updatedGeneratedIds);

        toast({
          title: "Success",
          description: `${targetType} generated successfully`,
        });

        // Navigate back with query params
        await saveCardAndNavigate(targetType, savedEntityId, updatedGeneratedIds);
      } catch (error) {
        console.error(`Error generating ${targetType}:`, error);
        toast({
          title: "Generation Error",
          description: error instanceof Error ? error.message : `Failed to generate ${targetType}`,
          variant: "destructive",
        });
      } finally {
        setIsGenerating(false);
      }
    };

    // Helper function to save card data to entity
    const saveCardToEntity = async (responseCardData: Record<string, unknown>, cardType: CardType): Promise<string> => {
      if (!id || !type) {
        throw new Error("Missing card id or type");
      }

      const entityId = getEntityIdByCardType(cardType);
      const entityFormData = new FormData();
      
      // Append all cardData fields to formData
      Object.entries(responseCardData).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          if (typeof value === 'object' && !(value instanceof File) && !(value instanceof Blob)) {
            entityFormData.append(key, JSON.stringify(value));
          } else if (value instanceof File || value instanceof Blob) {
            entityFormData.append(key, value);
          } else {
            entityFormData.append(key, String(value));
          }
        }
      });

      // Add queryId to card entity (current card's id)
      entityFormData.append("queryId", id);

      // Add reference type (current card type)
      entityFormData.append("referenceType", type);

      // Save to entity and get the stored _id
      const saveResponse = await postServiceByEntity(entityId, entityFormData);
      const savedEntityId = saveResponse._id || saveResponse.id;

      if (!savedEntityId) {
        throw new Error(`Failed to save ${cardType} data to entity`);
      }

      return savedEntityId;
    };

    // Generate complete flow (all remaining steps)
    const generateComplete = async () => {
      if (!cardData || !type || !id) return;

      setIsGenerating(true);
      try {
        const userId = getUserId();
        const query = (cardData.query as string) || (cardData.title as string) || "";
        const newCardIds: Record<string, string> = {};

          // Generate in sequence based on current type
          let result: AgentResponse;
          if (type === "moodboard") {
            // Generate room-layout
            result = await generateRoomLayoutCard({
              userId,
              query,
              previousCardData: cardData,
            });
            
            // Transform agent response to card data
            const agentResponse = result as {
              workflowlog?: {
                tasks?: Array<{
                  result?: {
                    data?: Record<string, unknown>;
                  };
                }>;
              };
              tasks?: Array<{
                result?: {
                  data?: Record<string, unknown>;
                };
              }>;
            };

            const taskData = agentResponse?.workflowlog?.tasks?.[0]?.result?.data || 
                            agentResponse?.tasks?.[0]?.result?.data || 
                            {} as Record<string, unknown>;

            if (taskData && Object.keys(taskData).length > 0) {
              // Save room-layout to entity
              const layoutId = await saveCardToEntity(taskData, "room-layout");
              newCardIds["room-layout"] = layoutId;

              // Generate furniture-bundle
              result = await generateFurnitureBundleCard({
                userId,
                query,
                previousCardData: taskData,
              });

              const bundleAgentResponse = result as {
                workflowlog?: {
                  tasks?: Array<{
                    result?: {
                      data?: Record<string, unknown>;
                    };
                  }>;
                };
                tasks?: Array<{
                  result?: {
                    data?: Record<string, unknown>;
                  };
                }>;
              };

              const bundleData = bundleAgentResponse?.workflowlog?.tasks?.[0]?.result?.data || 
                              bundleAgentResponse?.tasks?.[0]?.result?.data || 
                              {} as Record<string, unknown>;

              if (bundleData && Object.keys(bundleData).length > 0) {
                // Save furniture-bundle to entity
                const bundleId = await saveCardToEntity(bundleData, "furniture-bundle");
                newCardIds["furniture-bundle"] = bundleId;

                // Generate BOQ
                result = await generateBOQCard({
                  userId,
                  query,
                  previousCardData: bundleData,
                });

                const boqAgentResponse = result as {
                  workflowlog?: {
                    tasks?: Array<{
                      result?: {
                        data?: Record<string, unknown>;
                      };
                    }>;
                  };
                  tasks?: Array<{
                    result?: {
                      data?: Record<string, unknown>;
                    };
                  }>;
                };

                const boqData = boqAgentResponse?.workflowlog?.tasks?.[0]?.result?.data || 
                              boqAgentResponse?.tasks?.[0]?.result?.data || 
                              {} as Record<string, unknown>;

                if (boqData && Object.keys(boqData).length > 0) {
                  // Save BOQ to entity
                  const boqId = await saveCardToEntity(boqData, "boq");
                  newCardIds["boq"] = boqId;
                }
              }
            }
          } else if (type === "room-layout") {
            // Generate furniture-bundle and boq
            result = await generateFurnitureBundleCard({
              userId,
              query,
            
            });

            const bundleAgentResponse = result as {
              workflowlog?: {
                tasks?: Array<{
                  result?: {
                    data?: Record<string, unknown>;
                  };
                }>;
              };
              tasks?: Array<{
                result?: {
                  data?: Record<string, unknown>;
                };
              }>;
            };

            const bundleData = bundleAgentResponse?.workflowlog?.tasks?.[2]?.result?.data || 
                            bundleAgentResponse?.tasks?.[2]?.result?.data || 
                            {} as Record<string, unknown>;

            if (bundleData && Object.keys(bundleData).length > 0) {
              // Save furniture-bundle to entity
              const bundleId = await saveCardToEntity(bundleData, "furniture-bundle");
              newCardIds["furniture-bundle"] = bundleId;

              // Generate BOQ
              result = await generateBOQCard({
                userId,
                query,
                previousCardData: bundleData,
              });

              const boqAgentResponse = result as {
                workflowlog?: {
                  tasks?: Array<{
                    result?: {
                      data?: Record<string, unknown>;
                    };
                  }>;
                };
                tasks?: Array<{
                  result?: {
                    data?: Record<string, unknown>;
                  };
                }>;
              };

              const boqData = boqAgentResponse?.workflowlog?.tasks?.[0]?.result?.data || 
                            boqAgentResponse?.tasks?.[0]?.result?.data || 
                            {} as Record<string, unknown>;

              if (boqData && Object.keys(boqData).length > 0) {
                // Save BOQ to entity
                const boqId = await saveCardToEntity(boqData, "boq");
                newCardIds["boq"] = boqId;
              }
            }
          } else if (type === "furniture-bundle") {
            // Generate BOQ only
            result = await generateBOQCard({
              userId,
              query,
              previousCardData: cardData,
            });

            const boqAgentResponse = result as {
              workflowlog?: {
                tasks?: Array<{
                  result?: {
                    data?: Record<string, unknown>;
                  };
                }>;
              };
              tasks?: Array<{
                result?: {
                  data?: Record<string, unknown>;
                };
              }>;
            };

            const boqData = boqAgentResponse?.workflowlog?.tasks?.[0]?.result?.data || 
                          boqAgentResponse?.tasks?.[0]?.result?.data || 
                          {} as Record<string, unknown>;

            if (boqData && Object.keys(boqData).length > 0) {
              // Save BOQ to entity
              const boqId = await saveCardToEntity(boqData, "boq");
              newCardIds["boq"] = boqId;
            }
          } else if (type === "room-generation") {
            // Generate room-generation
            result = await generateRoomGenerationCard({
              userId,
              query,
              files: cardData.image as string,
            
            });
          }

        const updatedGeneratedIds = { ...generatedCardIds, ...newCardIds };
        setGeneratedCardIds(updatedGeneratedIds);
        
        toast({
          title: "Success",
          description: "All remaining cards generated successfully",
        });

        // Navigate back with query params (use the last generated card)
        if (Object.keys(newCardIds).length > 0) {
          const lastCardType = Object.keys(newCardIds)[Object.keys(newCardIds).length - 1] as CardType;
          const lastCardId = newCardIds[lastCardType];
          await saveCardAndNavigate(lastCardType, lastCardId, updatedGeneratedIds);
        }
      } catch (error) {
        console.error("Error generating complete flow:", error);
        toast({
          title: "Generation Error",
          description: error instanceof Error ? error.message : "Failed to generate complete flow",
          variant: "destructive",
        });
      } finally {
        setIsGenerating(false);
      }
    };

    // Redirect to main page with query parameters
    const handleRedirectToMain = () => {
      const params = new URLSearchParams();
      
      // Add current card ID
      if (type === "moodboard" && id) {
        params.set("mood", id);
      } else if (type === "room-layout" && id) {
        params.set("layout", id);
      } else if (type === "furniture-bundle" && id) {
        params.set("complete", id);
      } else if (type === "boq" && id) {
        params.set("boq", id);
      } else if (type === "room-generation" && id) {
        params.set("room-generation", id);
      }

      // Add generated card IDs
      if (generatedCardIds["room-layout"]) {
        params.set("layout", generatedCardIds["room-layout"]);
      }
      if (generatedCardIds["furniture-bundle"]) {
        params.set("complete", generatedCardIds["furniture-bundle"]);
      }
      if (generatedCardIds["boq"]) {
        params.set("boq", generatedCardIds["boq"]);
      }
      if (generatedCardIds["room-generation"]) {
        params.set("room-generation", generatedCardIds["room-generation"]);
      }

      navigate(-1);
    };

    // Get available proceed options based on current card type
    const getProceedOptions = (): Array<{ type: CardType | "complete"; label: string; icon: React.ReactNode; description: string }> => {
      if (!type) return [];

      switch (type) {
        case "moodboard":
          return [
            {
              type: "room-layout",
              label: "Generate Room Layout",
              icon: <Ruler className="w-5 h-5" />,
              description: "Create room layout based on this moodboard",
            },
            {
              type: "furniture-bundle",
              label: "Generate Furniture Bundle",
              icon: <Package className="w-5 h-5" />,
              description: "Create furniture bundle directly",
            },
            {
              type: "boq",
              label: "Generate BOQ",
              icon: <FileText className="w-5 h-5" />,
              description: "Create bill of quantities",
            },
          ];
        case "room-layout":
          return [
            {
              type: "furniture-bundle",
              label: "Generate Furniture Bundle",
              icon: <Package className="w-5 h-5" />,
              description: "Create furniture bundle based on this layout",
            },
            {
              type: "boq",
              label: "Generate BOQ",
              icon: <FileText className="w-5 h-5" />,
              description: "Create bill of quantities",
            }
          ];
        case "furniture-bundle":
          return [
            {
              type: "boq",
              label: "Generate BOQ",
              icon: <FileText className="w-5 h-5" />,
              description: "Create bill of quantities based on this bundle",
            },
          ];
        case "boq":
          return [];
        default:
          return [];
      }
    };

    const renderCard = () => {
      if (!cardData || !type) return null;

      const proceedOptions = getProceedOptions();
      const hasProceedOptions = proceedOptions.length > 0;

      switch (type) {
        case "moodboard":
          return <MoodboardCard data={cardData as Parameters<typeof MoodboardCard>[0]['data']} disableClick isFullView onProceedNext={hasProceedOptions ? handleProceedNext : undefined} />;
        case "furniture-bundle":
          return <FurnitureBundleCard data={cardData as Parameters<typeof FurnitureBundleCard>[0]['data']} disableClick isFullView onProceedNext={hasProceedOptions ? handleProceedNext : undefined} />;
        case "boq":
          return <BOQCard data={cardData as Parameters<typeof BOQCard>[0]['data']} disableClick isFullView onProceedNext={hasProceedOptions ? handleProceedNext : undefined} />;
        case "room-layout":
          return <RoomLayoutCard data={cardData as Parameters<typeof RoomLayoutCard>[0]['data']} disableClick isFullView onProceedNext={hasProceedOptions ? handleProceedNext : undefined} />;
        case "room-generation":
          return <RoomGenerationCard data={cardData as Parameters<typeof RoomGenerationCard>[0]['data']} disableClick isFullView onProceedNext={hasProceedOptions ? handleProceedNext : undefined} />;
        case "floorplan-room-generation":
          return <FloorplanRoomGenerationCard data={cardData as Parameters<typeof FloorplanRoomGenerationCard>[0]['data']} disableClick isFullView onProceedNext={hasProceedOptions ? handleProceedNext : undefined} />;
        default:
          return null;
      }
    };

    if (isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">Loading ...</p>
          </div>
        </div>
      );
    }
    if(isGenerating) {
      return (
        <div className="min-h-screen bg-glass flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">Generating ...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="relative min-h-screen bg-background custom-scrollbar">
        {/* Header */}
        {/* <header className="sticky top-0 z-30 glass border-b border-border/50 backdrop-blur-xl">
          <div className="px-4 py-2 flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="rounded-full"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold capitalize">
              {type?.replace(/-/g, " ")} Details
            </h1>
          </div>
        </header> */}
        <div className="absolute top-4 left-0 z-50">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>

        {/* Card Content */}
        <main className="px-4 ">
          {cardData ? (
            <div className="animate-fade-in ">
              {renderCard()}
            </div>
          ) : (
            <div className="flex items-center justify-center min-h-[60vh]">
              <p className="text-muted-foreground">Card not found</p>
            </div>
          )}
        </main>

        {/* Proceed Options Dialog */}
        <Dialog open={showProceedDialog} onOpenChange={setShowProceedDialog}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Proceed to Next Step</DialogTitle>
              <DialogDescription>
                Choose which card type you want to generate next
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              {getProceedOptions().map((option) => (
                <Button
                  key={option.type}
                  variant="outline"
                  className="w-full justify-start h-auto p-4"
                  onClick={() => {
                    if (option.type === "complete") {
                      generateComplete();
                    } else {
                      generateCard(option.type);
                    }
                    setShowProceedDialog(false);
                  }}
                  disabled={isGenerating}
                >
                  <div className="flex items-start gap-3 w-full">
                    <div className="mt-0.5">{option.icon}</div>
                    <div className="flex-1 text-left">
                      <div className="font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {option.description}
                      </div>
                    </div>
                  </div>
                </Button>
              ))}
            </div>
            {Object.keys(generatedCardIds).length > 0 && (
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  variant="default"
                  className="flex-1"
                  onClick={handleRedirectToMain}
                >
                  View All Cards
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowProceedDialog(false);
                    setGeneratedCardIds({});
                  }}
                >
                  Close
                </Button>
              </div>
            )}
            {isGenerating && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Generating...</span>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

