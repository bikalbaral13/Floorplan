import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ImageExpandDialog } from "./ui/image-expand-dialog";

interface ProductsProps {
  prod: any[];
  onSelectImage: (imageUrl: string) => void;
}

export default function Products({ prod, onSelectImage }: ProductsProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const validProducts = prod.filter((item) => item?.image_file);

  return (
    <div className="w-full p-4 overflow-x-auto">
      <div className="flex gap-4 max-w-[320px] overflow-x-auto custom-scrollbar pb-4">
        {validProducts.map((item, index) => {
          const data = item.extracted_data;
          const hasDetails =
            data && Object.keys(data).length > 0;

          const isExpanded = expandedIndex === index;

          return (
            <div
              key={index}
              className="min-w-[220px] max-w-[220px] bg-background border rounded-xl shadow-md flex-shrink-0"
            >
              {/* IMAGE */}
              <div
                className=" relative aspect-square overflow-hidden rounded-t-xl cursor-pointer"
                onClick={(e) =>{  e.stopPropagation(); onSelectImage(item.image_file)}}
              >
                <img
                  src={item.image_file}
                  alt={data?.["Product Name"] || "Product image"}
                  className="w-full h-full object-cover hover:scale-105 transition-transform"
                  onError={(e) =>
                    ((e.target as HTMLImageElement).src = "/placeholder.svg")
                  }
                />
                <ImageExpandDialog imageUrl={item.image_file} />
              </div>

              {/* INFO */}
              <div className="p-3">
                <p className="text-sm font-semibold line-clamp-2">
                  {data?.["Product Name"] || "Unnamed product"}
                </p>

                {/* DETAILS BUTTON / FALLBACK */}
                {hasDetails ? (
                  <button
                    className="flex items-center gap-1 text-xs text-primary mt-2"
                    onClick={() =>
                      setExpandedIndex(isExpanded ? null : index)
                    }
                  >
                    {isExpanded ? "Hide details" : "See more details"}
                    {isExpanded ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground mt-2">
                    No details found
                  </p>
                )}

                {/* EXPANDED DETAILS */}
                {isExpanded && hasDetails && (
                  <div className="mt-2 text-xs space-y-1 text-muted-foreground">
                    {Object.entries(data).map(([key, value]) => (
                      <p key={key}>
                        <b>{key}:</b>{" "}
                        {Array.isArray(value)
                          ? value.join(", ")
                          : String(value)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
