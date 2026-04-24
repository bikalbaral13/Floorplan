/**
 * IntegrationManager.ts
 * =====================
 * Provides integration-ready service hooks for external platforms:
 *   - SharePoint  (document management)
 *   - Google Drive (file storage)
 *   - PowerBI     (analytics embedding)
 *
 * This manager does NOT directly call any external API or store secrets.
 * Instead, it provides:
 *   1. A registration interface for each provider
 *   2. A typed service contract per provider
 *   3. Event hooks so the application layer can wire real API calls
 *
 * The actual HTTP requests live in the React/backend layer, NOT here.
 * This keeps the BIM engine portable and secret-free.
 */

import type { EventBus } from "../core/EventBus";
import type { BIMEngineEvents, IntegrationConfig, IntegrationProvider } from "../types/bim.types";

// ---------------------------------------------------------------------------
// Service contracts — implement these in the React/backend layer
// ---------------------------------------------------------------------------

export interface SharePointService {
    /** Upload a file to a SharePoint document library */
    upload(siteId: string, libraryPath: string, filename: string, blob: Blob): Promise<string>;
    /** List files in a folder */
    listFiles(siteId: string, folderPath: string): Promise<{ name: string; url: string }[]>;
    /** Get a direct download URL */
    getDownloadUrl(siteId: string, fileId: string): Promise<string>;
}

export interface GoogleDriveService {
    /** Upload a file to a specific folder */
    upload(folderId: string, filename: string, blob: Blob): Promise<string>;
    /** List files in a folder */
    listFiles(folderId: string): Promise<{ name: string; url: string; id: string }[]>;
    /** Get file metadata */
    getFile(fileId: string): Promise<{ name: string; mimeType: string; webViewLink: string }>;
}

export interface PowerBIService {
    /** Get an embed token for a specific report */
    getEmbedToken(reportId: string): Promise<{ token: string; embedUrl: string; expiry: string }>;
    /** Trigger a dataset refresh */
    refreshDataset(datasetId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class IntegrationManager {
    private configs = new Map<IntegrationProvider, IntegrationConfig>();

    /** Service implementations injected from the application layer */
    private _sharepoint: SharePointService | null = null;
    private _googleDrive: GoogleDriveService | null = null;
    private _powerBI: PowerBIService | null = null;

    constructor(
        private readonly bus: EventBus<BIMEngineEvents>
    ) { }

    // ---------------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------------

    /**
     * Register an integration provider with its configuration.
     * This does NOT trigger any API calls — it stores the config so
     * service methods can use it later.
     */
    register(config: IntegrationConfig): void {
        this.configs.set(config.provider, config);
        console.log(`[IntegrationManager] Registered provider: ${config.provider}`);
    }

    /** Check whether a provider has been registered */
    isRegistered(provider: IntegrationProvider): boolean {
        return this.configs.has(provider);
    }

    /** Retrieve the stored config for a provider */
    getConfig(provider: IntegrationProvider): IntegrationConfig | undefined {
        return this.configs.get(provider);
    }

    /** Remove a provider config */
    unregister(provider: IntegrationProvider): void {
        this.configs.delete(provider);
    }

    // ---------------------------------------------------------------------------
    // Service injection — application layer provides implementations
    // ---------------------------------------------------------------------------

    setSharePointService(service: SharePointService): void {
        this._sharepoint = service;
    }

    setGoogleDriveService(service: GoogleDriveService): void {
        this._googleDrive = service;
    }

    setPowerBIService(service: PowerBIService): void {
        this._powerBI = service;
    }

    // ---------------------------------------------------------------------------
    // Service accessors — throw helpful errors if not yet wired
    // ---------------------------------------------------------------------------

    get sharepoint(): SharePointService {
        if (!this._sharepoint) {
            throw new Error(
                "[IntegrationManager] SharePoint service not injected. " +
                "Call integrationManager.setSharePointService(impl) first."
            );
        }
        return this._sharepoint;
    }

    get googleDrive(): GoogleDriveService {
        if (!this._googleDrive) {
            throw new Error(
                "[IntegrationManager] Google Drive service not injected. " +
                "Call integrationManager.setGoogleDriveService(impl) first."
            );
        }
        return this._googleDrive;
    }

    get powerBI(): PowerBIService {
        if (!this._powerBI) {
            throw new Error(
                "[IntegrationManager] PowerBI service not injected. " +
                "Call integrationManager.setPowerBIService(impl) first."
            );
        }
        return this._powerBI;
    }

    // ---------------------------------------------------------------------------
    // Convenience helpers
    // ---------------------------------------------------------------------------

    /** Upload a blob to the currently configured file-storage provider */
    async uploadFile(
        filename: string,
        blob: Blob,
        targetPath: string
    ): Promise<string> {
        const spConfig = this.configs.get("sharepoint");
        const gdConfig = this.configs.get("google-drive");

        if (spConfig && this._sharepoint) {
            const siteId = (spConfig.options?.siteId as string) ?? "";
            return this._sharepoint.upload(siteId, targetPath, filename, blob);
        }

        if (gdConfig && this._googleDrive) {
            return this._googleDrive.upload(targetPath, filename, blob);
        }

        throw new Error(
            "[IntegrationManager] No file-storage provider registered."
        );
    }

    /** List registered providers */
    listProviders(): IntegrationProvider[] {
        return [...this.configs.keys()];
    }
}
