import { createContext, useContext, useState, ReactNode } from "react";

export type CardType = "furniture-bundle" | "moodboard" | "product" | "room-layout" | "boq" | "room-generation" | "floorplan-room-generation";

export interface ReportCard {
  id: string;
  type: CardType;
  data: any;
}

interface ReportContextType {
  selectedCards: ReportCard[];
  addCardToReport: (card: ReportCard) => void;
  removeCardFromReport: (cardId: string) => void;
  clearReport: () => void;
  viewMode: boolean;
  setViewMode: (viewMode: boolean) => void;
}

const ReportContext = createContext<ReportContextType | undefined>(undefined);

export function ReportProvider({ children }: { children: ReactNode }) {
  const [selectedCards, setSelectedCards] = useState<ReportCard[]>([]);
  const [viewMode, setViewMode] = useState(false);

  const addCardToReport = (card: ReportCard) => {
    setSelectedCards((prev) => {
      // Check if card already exists
      if (prev.some((c) => c.id === card.id)) {
        return prev;
      }
      return [...prev, card];
    });
  };

  const removeCardFromReport = (cardId: string) => {
    setSelectedCards((prev) => prev.filter((card) => card.id !== cardId));
  };

  const clearReport = () => {
    setSelectedCards([]);
  };

  return (
    <ReportContext.Provider
      value={{
        selectedCards,
        addCardToReport,
        removeCardFromReport,
        clearReport,
        viewMode,
        setViewMode,
      }}
    >
      {children}
    </ReportContext.Provider>
  );
}

export function useReport() {
  const context = useContext(ReportContext);
  if (context === undefined) {
    throw new Error("useReport must be used within a ReportProvider");
  }
  return context;
}

