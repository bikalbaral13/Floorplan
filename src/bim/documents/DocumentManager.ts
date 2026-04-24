/**
 * DocumentManager.ts
 * ==================
 * Manages document links attached to models or individual IFC elements.
 *
 * A "document link" is a lightweight record that binds an external URL
 * (SharePoint, Google Drive, S3, …) to a BIM entity.
 *
 * This manager does NOT store or download actual files — it only manages
 * the linking metadata. File storage is handled by the backend / integration
 * layer.
 *
 * Lifecycle:
 *   - UI calls linkDocument() → record is stored + event emitted
 *   - Backend persists the link via the event handler
 *   - On page load, loadMany() hydrates previously saved links
 */

import type { EventBus } from "../core/EventBus";
import type { BIMEngineEvents, BIMDocumentLink, DocumentLinkType } from "../types/bim.types";

function newId(): string {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
}

export class DocumentManager {
    private links = new Map<string, BIMDocumentLink>();

    constructor(
        private readonly bus: EventBus<BIMEngineEvents>
    ) { }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Link a document to a model or element.
     */
    linkDocument(params: {
        targetId: string;
        targetType: DocumentLinkType;
        documentName: string;
        url: string;
        mimeType?: string;
        addedBy: string;
    }): BIMDocumentLink {
        const link: BIMDocumentLink = {
            id: newId(),
            targetId: params.targetId,
            targetType: params.targetType,
            documentName: params.documentName,
            url: params.url,
            mimeType: params.mimeType,
            addedBy: params.addedBy,
            addedAt: new Date().toISOString(),
        };

        this.links.set(link.id, link);
        console.log(
            `[DocumentManager] Linked "${link.documentName}" → ${link.targetType}:${link.targetId}`
        );
        return link;
    }

    /**
     * Remove a document link.
     */
    unlinkDocument(linkId: string): void {
        const link = this.links.get(linkId);
        if (!link) return;
        this.links.delete(linkId);
        console.log(`[DocumentManager] Unlinked document "${linkId}"`);
    }

    /**
     * Get all document links for a specific model or element.
     */
    getLinksFor(targetId: string): BIMDocumentLink[] {
        return [...this.links.values()].filter((l) => l.targetId === targetId);
    }

    /**
     * Get all document links.
     */
    getAll(): BIMDocumentLink[] {
        return [...this.links.values()];
    }

    /**
     * Bulk-load document links (e.g. from a backend API).
     */
    loadMany(data: BIMDocumentLink[]): void {
        for (const link of data) {
            this.links.set(link.id, link);
        }
        console.log(`[DocumentManager] Loaded ${data.length} document links.`);
    }

    /**
     * Open a document link in a new browser tab.
     */
    openDocument(linkId: string): void {
        const link = this.links.get(linkId);
        if (!link) return;
        window.open(link.url, "_blank", "noopener,noreferrer");
    }

    /**
     * Search links by document name.
     */
    search(query: string): BIMDocumentLink[] {
        const lower = query.toLowerCase();
        return [...this.links.values()].filter((l) =>
            l.documentName.toLowerCase().includes(lower)
        );
    }
}
