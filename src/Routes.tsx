import { Routes, Route } from "react-router-dom";
import ProjectListPage from "./pages/ProjectListPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import Report from "./pages/Report";
import NotFound from "./pages/NotFound";
import ProtectedLayout from "./pages/layout";
import SignIn from "./pages/signin";
import { PublicRoute } from "./pages/publicRoutes";
import CardDetail from "./pages/CardDetail";
import FurnitureBundleGeneration from "./pages/FurnitureBundleGeneration";
import ParentComponent from "./components/pagethl";
import ImageAnnotationPage from "./pages/ImageAnnotation";
import BuildingPage from "./components/BuildingConfiguratorViewer";
import ThreeDViewerPage from "./components/3dpopup";
import ThreeDGen from "./components/3dgen";
import PanoramaPage from "./pages/PanoramaPage";
import Presentation from "./pages/Presentation";
import BimViewerPage from "./pages/BimViewerPage";
import MeshyStudio from "./pages/MeshyStudio";
import ImageApiProcessor from "./pages/ImageApiProcessor";
import FloorPlanEditorPage from "./pages/FloorPlanEditorPage";


const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/signin" element={
        <PublicRoute>
          <SignIn />
        </PublicRoute>
      } />



      {/* Protected Group */}
      <Route element={<ProtectedLayout />}>
        {/* Public Routes */}
        <Route path="/" element={<ProjectListPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />


        {/* <Route path="/html" element={<ParentComponent />} /> */}
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
  );
};

export default AppRoutes;

