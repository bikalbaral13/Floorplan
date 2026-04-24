import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

interface ImageExpandDialogProps {
  imageUrl: string;
  alt?: string;
  className?: string;
  triggerClassName?: string;
  showTrigger?: boolean;
  children?: React.ReactNode;
  additionalImages?: string[];
}

export function ImageExpandDialog({
  imageUrl,
  alt = "Image",
  className,
  triggerClassName,
  showTrigger = true,
  children,
  additionalImages = [],
}: ImageExpandDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  const allImages = [imageUrl, ...additionalImages];
  const hasMultipleImages = allImages.length > 1;

  return (
    <>
      {showTrigger && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "absolute bottom-2 right-2  h-8 w-8 rounded-full bg-background/90 hover:bg-background shadow-lg backdrop-blur-sm",
            triggerClassName
          )}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(true);
          }}
          aria-label="Expand image"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      )}
      
      {children && (
        <div
          className="absolute top-2 right-2 z-10 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(true);
          }}
        >
          {children}
        </div>
      )}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-[70vw] md:max-h-full max-h-[95vh] p-0  border-none shadow-none">
            <Button
              variant="ghost"
              size="icon"
            className="absolute top-2 right-2 h-10 w-10 rounded-full bg-background/90 hover:bg-background text-foreground shadow-lg z-50"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          <div className="relative w-full h-full flex items-center justify-center p-4">
            {hasMultipleImages ? (
              <Carousel className="w-full max-w-full">
                <CarouselContent>
                  {allImages.map((img, index) => (
                    <CarouselItem key={index} className="flex items-center justify-center">
                      <img
                        src={img}
                        alt={`${alt} ${index + 1}`}
                        className={cn(
                          "max-w-full max-h-[85vh] object-contain rounded-lg",
                          className
                        )}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = "/placeholder.svg";
                        }}
                      />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="left-4" />
                <CarouselNext className="right-4" />
              </Carousel>
            ) : (
                <img
                  src={imageUrl}
                  alt={alt}
                  className={cn(
                    "max-w-full max-h-[95vh] min-h-[40vh] object-cover rounded-lg",
                    className
                  )}
                  onClick={(e) => e.stopPropagation()}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = "/placeholder.svg";
                  }}
                />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

