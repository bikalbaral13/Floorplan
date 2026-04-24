import { FloorPlanEditor } from "@/floorplan/FloorPlanEditor";
import { useParams } from "react-router-dom";

const FloorPlanEditorPage = () => {
  const { projectId } = useParams<{ projectId?: string }>();
  return <FloorPlanEditor projectId={projectId} />;
};

export default FloorPlanEditorPage;
