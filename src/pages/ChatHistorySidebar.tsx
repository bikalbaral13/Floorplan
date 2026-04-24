import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { getServiceByEntity } from "@/api/action";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  moodboardEntityId,
  roomLayoutEntityId,
  furnitureBundleEntityId,
  boqEntityId,
  roomGenerationEntityId,
  floorplanRoomGenerationEntityId,
  designinput,
} from "@/lib/const";

export interface OutputCardData {
  id: string;
  type: "product" | "moodboard" | "furniture-bundle" | "boq" | "room-layout" | "room-generation" | "floorplan-room-generation" | "design-with-inputs";
  data: any;
}

interface ProjectDetailsSidebarProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  outputCards?: OutputCardData[];
}

const entityConfigs = [
  // { id: moodboardEntityId, name: "Moodboards", type: "moodboard" },
  // { id: roomLayoutEntityId, name: "Room Layouts", type: "room-layout" },
  // { id: furnitureBundleEntityId, name: "Furniture Bundles", type: "furniture-bundle" },
  // // { id: boqEntityId, name: "BOQs", type: "boq" },
  // { id: roomGenerationEntityId, name: "Room Generations", type: "room-generation" },
  // { id: floorplanRoomGenerationEntityId, name: "Floorplans", type: "floorplan-room-generation" },
  { id: "69d0b54cad8abad1ca92d84b", name: "Innova Design", type: "innova-design" },
];

const SidebarContent = ({ onOpenChange }: { onOpenChange: (open: boolean) => void }) => {
  const navigate = useNavigate();
  const [groupedData, setGroupedData] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const data: Record<string, any[]> = {};

      try {
        for (const config of entityConfigs) {
          const result = await getServiceByEntity(config.id);
          const items = Array.isArray(result)
            ? result
            : result?.data || [];

          console.log("Sidebar items:", items);

          if (items.length > 0) {
            data[config.name] = items.map((item: any) => ({
              ...item,
              _entityType: config.type,
            }));
          }
        }

        // Order is preserved here
        setGroupedData(data);
      } catch (error) {
        console.error("Error fetching sidebar data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);


  const handleItemClick = (item: any) => {
    const id = item._id || item.id;
    const type = item._entityType;

    if (type === "innova-design") {
      navigate(`/innova-design/${id}`);
    } else if (type === "floorplan-room-generation") {
      navigate(`/?floorplan-room-gen=${id}`);
      window.location.reload();
    }
    else if (type === "furniture-bundle") {
      navigate(`/?complete=${id}`);
      window.location.reload();

    }
    else {
      navigate(`/card/${type}/${id}`);
    }
    onOpenChange(false);
  };

  return (
    <>
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2" onClick={() => navigate("/")} style={{ cursor: 'pointer' }}>
          <FolderOpen className="w-5 h-5" />
          <h2 className="font-semibold text-lg">Project Details</h2>
        </div>
        <button
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={() => {
            localStorage.removeItem("token");
            navigate("/signin");
          }}
        >
          Log out
        </button>
      </div>
      <ScrollArea className="h-[calc(100vh-80px)]">
        <div className="p-4">
          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : Object.keys(groupedData).length === 0 ? (
            <div className="text-center p-8 text-muted-foreground text-sm">
              No projects found
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedData).map(([sectionName, items]) => (
                <div key={sectionName} className="space-y-2">
                  <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {sectionName}
                  </h3>
                  <div className="space-y-1">
                    {items.map((item, index) => (
                      <Button
                        key={item._id || index}
                        variant="ghost"
                        className="w-full justify-start h-auto p-3 text-left hover:bg-accent group relative"
                        onClick={() => handleItemClick(item)}
                      >
                        <div className="space-y-1 w-full">
                          <div className="font-medium text-sm truncate pr-4">
                            {item.query || item.title || item.name || `Project ${index + 1}`}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {item.timestamp ? new Date(item.timestamp).toLocaleDateString() : 'Recent'}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  );
};

export function ProjectDetailsSidebar({
  isOpen,
  onOpenChange,
  outputCards,
}: ProjectDetailsSidebarProps) {
  const [isMobile, setIsMobile] = useState(false);
const navigate = useNavigate();
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <>
      {/* Mobile: Overlay Sheet */}
      {isMobile && (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
          <SheetContent side="left" className="w-[300px] sm:w-[400px] p-0">
            <SidebarContent onOpenChange={onOpenChange} />
          </SheetContent>
        </Sheet>
      )}

      {/* Desktop: Fixed Sidebar */}
      {!isMobile && (
        <aside
          className={`fixed left-0 top-0 h-screen w-[280px] lg:w-[320px] bg-background border-r border-border transition-transform duration-300 z-20 ${
            isOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex flex-col w-full h-full bg-background">
            <SidebarContent onOpenChange={onOpenChange} />
          </div>
        </aside>
      )}
    </>
  );
}

