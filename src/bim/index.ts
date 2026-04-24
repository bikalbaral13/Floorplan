/**
 * BIM Module — Public Barrel Export
 * ==================================
 * Import everything from "@/bim" in consumer code:
 *
 *   import { BIMEngine, type BIMModel } from "@/bim";
 */

// Core
export { BIMEngine } from "./core/BIMEngine";
export { EventBus } from "./core/EventBus";
export { WorldManager } from "./core/WorldManager";

// Loaders
export { IFCManager } from "./loaders/IFCManager";
export { FormatManager } from "./loaders/FormatManager";

// Tools
export { NavigationManager } from "./tools/NavigationManager";
export { SelectionManager } from "./tools/SelectionManager";
export { SectionManager } from "./tools/SectionManager";
export { TransformManager } from "./tools/TransformManager";

// Measurements
export { MeasurementManager } from "./measurements/MeasurementManager";

// Annotations
export { AnnotationManager } from "./annotations/AnnotationManager";

// Documents
export { DocumentManager } from "./documents/DocumentManager";

// Export
export { ExportManager } from "./export/ExportManager";

// GIS
export { GISManager } from "./gis/GISManager";

// Integrations
export { IntegrationManager } from "./integrations/IntegrationManager";
export type {
    SharePointService,
    GoogleDriveService,
    PowerBIService,
} from "./integrations/IntegrationManager";

// Types
export type {
    BIMModel,
    BIMModelFormat,
    BIMSelectionEvent,
    BIMMeasurement,
    MeasurementType,
    BIMAnnotation,
    CameraState,
    BIMDocumentLink,
    DocumentLinkType,
    SectionAxis,
    SectionPlaneConfig,
    NavigationMode,
    GeoReference,
    IntegrationProvider,
    IntegrationConfig,
    BIMEngineEvents,
    BIMEngineConfig,
} from "./types/bim.types";
