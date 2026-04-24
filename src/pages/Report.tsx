import { useState, useRef } from "react";
import { ArrowLeft, Download, Share2, Printer, Image, FileText, Check } from "lucide-react";
import { useReport } from "@/contexts/ReportContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { CoverPage } from "@/components/report/CoverPage";
import { StyleOverview } from "@/components/report/StyleOverview";
import { Moodboard } from "@/components/report/Moodboard";
import { RoomLayouts } from "@/components/report/RoomLayouts";
import { ColorPalette } from "@/components/report/ColorPalette";
import { ProductList } from "@/components/report/ProductList";
import { PricingSummary } from "@/components/report/PricingSummary";
import { PagePreview } from "@/components/report/PagePreview";
import { DraggableSection } from "@/components/report/DraggableSection";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export default function Report() {
  const navigate = useNavigate();
  const { viewMode, setViewMode } = useReport();
  const [includeLogo, setIncludeLogo] = useState(true);
  const [includeSupplierLogos, setIncludeSupplierLogos] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  
  const [sections, setSections] = useState([
    { id: "cover", title: "Cover Page", component: CoverPage, fixed: true },
    { id: "style", title: "Style Overview", component: StyleOverview, fixed: false },
    { id: "moodboard", title: "Moodboard", component: Moodboard, fixed: false },
    { id: "layouts", title: "Room Layouts", component: RoomLayouts, fixed: false },
    { id: "colors", title: "Color Palette", component: ColorPalette, fixed: false },
    { id: "products", title: "Product List", component: ProductList, fixed: false },
    { id: "pricing", title: "Pricing Summary", component: PricingSummary, fixed: false },
  ]);

  const handleReorder = (fromIndex: number, toIndex: number) => {
    if (sections[fromIndex].fixed || sections[toIndex].fixed) return;
    
    const newSections = [...sections];
    const [removed] = newSections.splice(fromIndex, 1);
    newSections.splice(toIndex, 0, removed);
    setSections(newSections);
  };

  const reportRef = useRef<HTMLDivElement>(null);

  const handlePrint = async () => {
    if (!reportRef.current) return;

    // Save current viewMode and enable viewMode for printing
    const previousViewMode = viewMode;
    setViewMode(true);
    
    try {
      
      // Wait for UI to update with viewMode
      await new Promise((resolve) => setTimeout(resolve, 500));

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        // Restore viewMode if window failed to open
        setViewMode(previousViewMode);
        return;
      }

      const images: string[] = [];

      // Capture each page as an image
      for (let i = 0; i < sections.length; i++) {
        // Show the current page
        setCurrentPage(i);
        
        // Wait for the page to render
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Find the page element
        const pageElement = reportRef.current.querySelector(
          `[data-page-index="${i}"]`
        ) as HTMLElement;

        if (pageElement) {
          // Capture the page as canvas
          const canvas = await html2canvas(pageElement, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: "#ffffff",
          });

          images.push(canvas.toDataURL("image/png"));
        }
      }

      // Reset to first page
      setCurrentPage(0);
      
      // Restore previous viewMode
      setViewMode(previousViewMode);

      // Create print document with all images
      const printContent = images.map((img, index) => `
        <div style="page-break-after: always; width: 8.5in; height: 11in; margin: 0; padding: 0; ">
          <img src="${img}" style="width: 100%; height: 100%; object-fit: contain;" />
        </div>
      `).join("");

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Design Report</title>
            <style>
              @page {
                size: letter;
                margin: 0;
              }
              body {
                margin: 0;
                padding: 0;
                font-family: system-ui, -apple-system, sans-serif;
              }
              @media print {
                div {
                  page-break-after: always;
                }
                div:last-child {
                  page-break-after: auto;
                }
              }
            </style>
          </head>
          <body>
            ${printContent}
          </body>
        </html>
      `);
      printWindow.document.close();
      
      // Wait for images to load, then print
      setTimeout(() => {
        printWindow.print();
        // Don't close immediately - let user see print dialog
        setTimeout(() => printWindow.close(), 1000);
      }, 500);
    } catch (error) {
      console.error("Error printing:", error);
      alert("Failed to prepare print. Please try again.");
      // Restore viewMode on error
      setViewMode(previousViewMode);
    }
  };

  const handleDownloadAll = async () => {
    if (!reportRef.current) return;

    // Save current viewMode and enable viewMode for PDF generation
    const previousViewMode = viewMode;
    setViewMode(true);
    
    try {
      
      // Wait for UI to update with viewMode
      await new Promise((resolve) => setTimeout(resolve, 500));

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "in",
        format: [8.5, 11],
      });

      // Loop through each section and capture it
      for (let i = 0; i < sections.length; i++) {
        // Show the current page
        setCurrentPage(i);
        
        // Wait for the page to render
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Find the page element
        const pageElement = reportRef.current.querySelector(
          `[data-page-index="${i}"]`
        ) as HTMLElement;

        if (pageElement) {
          // Capture the page as canvas
          const canvas = await html2canvas(pageElement, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: "#ffffff",
          });

          const imgData = canvas.toDataURL("image/png");
          const imgWidth = 8.5;
          const imgHeight = (canvas.height * imgWidth) / canvas.width;

          // Add new page (except for the first one)
          if (i > 0) {
            pdf.addPage();
          }

          // Add image to PDF
          pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
        }
      }

      // Reset to first page
      setCurrentPage(0);
      
      // Restore previous viewMode
      setViewMode(previousViewMode);

      // Save the PDF
      pdf.save("design-report.pdf");
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Failed to generate PDF. Please try again.");
      // Restore viewMode on error
      setViewMode(previousViewMode);
    }
  };

  const handleExport = (format: string) => {
    if (format === "print") {
      handlePrint();
    } else if (format === "download") {
      handleDownloadAll();
    } else {
      console.log(`Exporting as ${format}`);
      // Other export logic would go here
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-glass border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              className="rounded-full"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            
            <h1 className="text-lg font-semibold text-foreground">Design Report</h1>

            <div className="flex gap-2">
              <Button
                variant={viewMode ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode(!viewMode)}
                className="rounded-full"
                title={viewMode ? "Switch to edit mode" : "Switch to view mode"}
              >
                <Check className="w-4 h-4 mr-2" />
                {viewMode ? "View Mode" : "Edit Mode"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("pdf")}
                className="rounded-full"
              >
                <FileText className="w-4 h-4 mr-2" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("jpg")}
                className="rounded-full"
              >
                <Image className="w-4 h-4 mr-2" />
                JPG
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[300px,1fr] gap-6">
          {/* Sidebar Controls */}
          <aside className="space-y-6">
            {/* Branding Options */}
            <div className="bg-card rounded-2xl p-4 border border-border shadow-card">
              <h3 className="text-sm font-semibold text-foreground mb-4">Branding</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="logo" className="text-sm text-muted-foreground">
                    Include My Logo
                  </Label>
                  <Switch
                    id="logo"
                    checked={includeLogo}
                    onCheckedChange={setIncludeLogo}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="supplier-logos" className="text-sm text-muted-foreground">
                    Supplier Logos
                  </Label>
                  <Switch
                    id="supplier-logos"
                    checked={includeSupplierLogos}
                    onCheckedChange={setIncludeSupplierLogos}
                  />
                </div>
              </div>
            </div>

            {/* Page Order */}
            <div className="bg-card rounded-2xl p-4 border border-border shadow-card">
              <h3 className="text-sm font-semibold text-foreground mb-4">Page Order</h3>
              <div className="space-y-2">
                {sections.map((section, index) => (
                  <DraggableSection
                    key={section.id}
                    section={section}
                    index={index}
                    onReorder={handleReorder}
                    isActive={currentPage === index}
                    onClick={() => setCurrentPage(index)}
                  />
                ))}
              </div>
            </div>

            {/* Export Actions */}
            <div className="bg-card rounded-2xl p-4 border border-border shadow-card">
              <h3 className="text-sm font-semibold text-foreground mb-4">Export</h3>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start rounded-xl"
                  onClick={() => handleExport("whatsapp")}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share via WhatsApp
                </Button>
                {/* <Button
                  variant="outline"
                  className="w-full justify-start rounded-xl"
                  onClick={() => handleExport("print")}
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                </Button> */}
                <Button
                  variant="outline"
                  className="w-full justify-start rounded-xl"
                  onClick={() => handleExport("download")}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Print
                </Button>
              </div>
            </div>

            {/* Page Thumbnails */}
            <div className="bg-card rounded-2xl p-4 border border-border shadow-card">
              <h3 className="text-sm font-semibold text-foreground mb-4">Pages</h3>
              <div className="grid grid-cols-2 gap-2">
                {sections.map((section, index) => (
                  <PagePreview
                    key={section.id}
                    pageNumber={index + 1}
                    title={section.title}
                    isActive={currentPage === index}
                    onClick={() => setCurrentPage(index)}
                  />
                ))}
              </div>
            </div>
          </aside>

          {/* Main Report View */}
          <main className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
            <div ref={reportRef} className="aspect-[8.5/11] bg-white">
              {sections.map((section, index) => {
                const Component = section.component;
                return (
                  <div
                    key={section.id}
                    data-page-index={index}
                    className={currentPage === index ? "block" : "hidden"}
                  >
                    <Component
                      includeLogo={includeLogo}
                      includeSupplierLogos={includeSupplierLogos}
                    />
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
