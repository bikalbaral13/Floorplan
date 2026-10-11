import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import NotFound from "./pages/NotFound";
import ProtectedLayout from "./pages/layout";
import SignIn from "./pages/signin";
import { PublicRoute } from "./pages/publicRoutes";

// Every page is its own chunk: the editor, the BIM / IFC viewer (@thatopen), the 3D pages (three, r3f) and the
// PDF-reading pages (pdfjs) used to ship in one entry bundle that every visitor downloaded before anything drew.
const ProjectListPage = lazy(() => import("./pages/ProjectListPage"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));
const ImageAnnotationPage = lazy(() => import("./pages/ImageAnnotation"));
const ThreeDViewerPage = lazy(() => import("./components/3dpopup"));
const ThreeDGen = lazy(() => import("./components/3dgen"));
const PanoramaPage = lazy(() => import("./pages/PanoramaPage"));
const Presentation = lazy(() => import("./pages/Presentation"));
const BimViewerPage = lazy(() => import("./pages/BimViewerPage"));
const MeshyStudio = lazy(() => import("./pages/MeshyStudio"));
const ImageApiProcessor = lazy(() => import("./pages/ImageApiProcessor"));
const FloorPlanEditorPage = lazy(() => import("./pages/FloorPlanEditorPage"));

const Loading = () => (
  <div className="flex h-screen w-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
);

const AppRoutes = () => {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/signin" element={
          <PublicRoute>
            <SignIn />
          </PublicRoute>
        } />

        {/* Protected Group */}
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<ProjectListPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/innova-design/:id?" element={<ImageAnnotationPage />} />
          <Route path="/building-configurator/:id?" element={<ThreeDViewerPage />} />
          <Route path="/3d-model/:id?" element={<ThreeDGen />} />
          <Route path="/panorama" element={<PanoramaPage />} />
          <Route path="/presentation/:id?" element={<Presentation />} />
          <Route path="/bim" element={<BimViewerPage />} />
          <Route path="/meshy/:id?" element={<MeshyStudio />} />
          <Route path="/image-api-processor/:id?" element={<ImageApiProcessor />} />
          <Route path="/floorplan-editor" element={<FloorPlanEditorPage />} />
          <Route path="/floorplan-editor/:projectId" element={<FloorPlanEditorPage />} />

          {/* Catch-all route - must be last */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

export default AppRoutes;
