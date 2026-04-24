import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import ProtectedRoute from "@/pages/protectedRoute";
import { MeasurementUnitProvider } from "@/hooks/useMeasurementUnit";
import { ProjectsProvider } from "@/contexts/ProjectsContext";
// import { ProjectDetailsSidebar } from "@/components/chat/ChatHistorySidebar";

function ProtectedLayout() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
        <ProtectedRoute>
            <MeasurementUnitProvider>
                <ProjectsProvider>
                <div className="relative min-h-screen bg-background">
                    {/* Floating Toggle Button */}
                    {/* <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className={`fixed top-4 left-4 z-50 w-10 h-10 rounded-full bg-background/80 backdrop-blur-md border border-border flex items-center justify-center hover:bg-accent transition-all shadow-sm ${isSidebarOpen ? "md:left-[290px] lg:left-[330px]" : "left-4"
                            }`}
                        aria-label="Toggle Project Sidebar"
                    >
                        <div className="w-5 h-5 flex flex-col justify-center items-center gap-1">
                            <span className={`w-4 h-0.5 bg-foreground rounded-full transition-all ${isSidebarOpen ? "rotate-45 translate-y-1.5" : ""}`} />
                            <span className={`w-4 h-0.5 bg-foreground rounded-full transition-all ${isSidebarOpen ? "opacity-0" : ""}`} />
                            <span className={`w-4 h-0.5 bg-foreground rounded-full transition-all ${isSidebarOpen ? "-rotate-45 -translate-y-1.5" : ""}`} />
                        </div>
                    </button> */}

                    {/* <ProjectDetailsSidebar
                        isOpen={isSidebarOpen}
                        onOpenChange={setIsSidebarOpen}
                    /> */}

                    <main className={`transition-all duration-300 ${isSidebarOpen ? "md:pl-[280px] lg:pl-[320px]" : "pl-0"}`}>
                        <Outlet />
                    </main>
                </div>
                </ProjectsProvider>
            </MeasurementUnitProvider>
        </ProtectedRoute>
    );
}

export default ProtectedLayout;
