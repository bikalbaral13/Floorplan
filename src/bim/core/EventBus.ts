/**
 * EventBus.ts
 * ===========
 * A strongly-typed, synchronous publish-subscribe event bus.
 *
 * Usage:
 *   const bus = new EventBus<BIMEngineEvents>();
 *   const unsub = bus.on("model:loaded", (model) => console.log(model));
 *   bus.emit("model:loaded", model);
 *   unsub(); // remove listener
 *
 * Design goals:
 *   - Zero dependencies beyond TypeScript
 *   - Full type inference for payloads
 *   - Memory-safe unsubscribe pattern
 *   - Support for wildcard "*" listeners (useful for logging / analytics)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

type Listener<T> = (payload: T) => void;

// Unsubscribe function returned from `on()`
export type Unsubscribe = () => void;

export class EventBus<Events extends AnyRecord = AnyRecord> {
    // Map of event name → Set of listeners
    private listeners = new Map<keyof Events, Set<Listener<unknown>>>();
    // Wildcard listeners receive every event
    private wildcardListeners = new Set<(name: string, payload: unknown) => void>();

    /**
     * Subscribe to a specific event.
     * @returns Unsubscribe function — call it to remove the listener.
     */
    on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        const set = this.listeners.get(event)!;
        set.add(listener as Listener<unknown>);

        return () => {
            set.delete(listener as Listener<unknown>);
            if (set.size === 0) {
                this.listeners.delete(event);
            }
        };
    }

    /**
     * Subscribe to every event (useful for debugging / telemetry).
     * @returns Unsubscribe function.
     */
    onAny(listener: (name: string, payload: unknown) => void): Unsubscribe {
        this.wildcardListeners.add(listener);
        return () => this.wildcardListeners.delete(listener);
    }

    /**
     * Subscribe to an event but auto-unsubscribe after the first emission.
     */
    once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
        const unsub = this.on(event, (payload) => {
            unsub();
            listener(payload);
        });
        return unsub;
    }

    /**
     * Emit an event synchronously to all registered listeners.
     */
    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        // Typed listeners
        const set = this.listeners.get(event);
        if (set) {
            for (const listener of set) {
                try {
                    listener(payload);
                } catch (err) {
                    console.error(`[EventBus] Error in listener for "${String(event)}":`, err);
                }
            }
        }
        // Wildcard listeners
        for (const wl of this.wildcardListeners) {
            try {
                wl(String(event), payload);
            } catch (err) {
                console.error("[EventBus] Error in wildcard listener:", err);
            }
        }
    }

    /**
     * Returns true if at least one listener is registered for the given event.
     */
    hasListeners<K extends keyof Events>(event: K): boolean {
        return (this.listeners.get(event)?.size ?? 0) > 0;
    }

    /**
     * Remove all listeners for a specific event (or all events if omitted).
     */
    clear(event?: keyof Events): void {
        if (event !== undefined) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
            this.wildcardListeners.clear();
        }
    }

    /**
     * Return a Promise that resolves the next time the given event is emitted.
     * Optional timeout (ms) — rejects if the event never fires within the window.
     */
    waitFor<K extends keyof Events>(event: K, timeoutMs?: number): Promise<Events[K]> {
        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = null;

            const unsub = this.once(event, (payload) => {
                if (timer !== null) clearTimeout(timer);
                resolve(payload);
            });

            if (timeoutMs !== undefined) {
                timer = setTimeout(() => {
                    unsub();
                    reject(new Error(`[EventBus] Timeout waiting for event "${String(event)}"`));
                }, timeoutMs);
            }
        });
    }
}
