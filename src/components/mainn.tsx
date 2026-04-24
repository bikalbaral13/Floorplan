import { useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { SearchDock } from "./Search";

const Index = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const { toast } = useToast();

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    toast({
      title: "Searching...",
      description: `Finding designs for "${query}"`,
    });
  };

  const handleRefine = () => {
    setIsRefining(true);
  };

  const handleApplyRefinement = (refinements: any) => {
    toast({
      title: "Refinement Applied",
      description: "Regenerating with your preferences",
    });
  };

  const handleAddToReport = (title: string) => {
    toast({
      title: "Added to Report",
      description: `${title} has been added to your report builder`,
    });
  };

  // Sample data
  const sampleCards = [
    {
      type: "style" as const,
      title: "Warm Minimalist Bedroom",
      image: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?q=80&w=1000",
      tags: ["Modern", "Cozy", "Neutral"],
    },
    {
      type: "product" as const,
      title: "Linen Armchair",
      image: "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?q=80&w=1000",
      tags: ["Seating", "Natural"],
      price: "$1,299",
      brand: "West Elm",
    },
    {
      type: "style" as const,
      title: "Scandinavian Living Room",
      image: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?q=80&w=1000",
      tags: ["Light", "Airy", "Minimal"],
    },
    {
      type: "layout" as const,
      title: "Open Kitchen Layout",
      image: "https://images.unsplash.com/photo-1556911220-bff31c812dba?q=80&w=1000",
      tags: ["Functional", "Modern"],
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <header className="sticky top-0 z-30 glass border-b border-border/50 backdrop-blur-xl">
        <div className="px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Design Studio</h1>
          <div className="flex items-center gap-2">
                {/* Report Button need to be included here */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent/70" />
          </div>
        </div>
      </header>

      {/* Main Feed */}
      <main className="px-4 py-6">
        {searchQuery ? (
          <>
            {/* Search Results Header */}
            <div className="mb-6 animate-fade-in">
              <h2 className="text-2xl font-bold mb-2">
                Results for "{searchQuery}"
              </h2>
              <p className="text-muted-foreground">
                Found {sampleCards.length} design inspirations
              </p>
            </div>

            {/* Cards Grid */}
            
          </>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6 animate-fade-in">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-accent/20 to-accent/10 flex items-center justify-center mb-6">
              <svg
                className="w-10 h-10 text-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-3">
              Discover Your Perfect Design
            </h2>
            <p className="text-muted-foreground max-w-sm mb-8">
              Search for styles, products, layouts, or describe your vision.
              AI will help you create stunning interior designs.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {[
                "Modern bedroom",
                "Cozy living room",
                "Minimalist kitchen",
                "Bohemian workspace",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSearch(prompt)}
                  className="px-4 py-2 bg-secondary rounded-full text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-smooth"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Search Dock */}
      <SearchDock onSearch={handleSearch} />

     
    </div>
  );
};

export default Index;