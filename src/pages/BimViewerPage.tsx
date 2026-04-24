import React from "react";
import BIMViewer from "../bim/viewer/BIMViewer";

const BimViewerPage: React.FC = () => {
    return (
        <div style={{ width: "100%", height: "100vh", minHeight: "600px" }}>
            <BIMViewer
                className="w-full h-full"
            />
        </div>
    );
};

export default BimViewerPage;
