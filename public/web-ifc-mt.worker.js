"use strict";
/**
 * Patched web-ifc-mt.worker.js
 * ============================
 * Original: node_modules/web-ifc/web-ifc-mt.worker.js
 *
 * WHY PATCHED:
 * MetaMask and other wallets inject a "lockdown" (SES - Secure ECMAScript)
 * environment that wraps the global Blob constructor. When web-ifc's
 * Emscripten pthread code calls URL.createObjectURL(sesWrappedBlob), the
 * browser's native code rejects it with:
 *   TypeError: Failed to execute 'createObjectURL' on 'URL':
 *              Overload resolution failed.
 *
 * The patch adds a try/catch around createObjectURL and falls back to
 * importScripts('/web-ifc-api.js'), which is the same file served as a
 * static asset from /public so it's always available at that URL.
 */

var Module = {};
var initializedJS = false;

function threadPrintErr() {
    var text = Array.prototype.slice.call(arguments).join(" ");
    console.error(text);
}
function threadAlert() {
    var text = Array.prototype.slice.call(arguments).join(" ");
    postMessage({ cmd: "alert", text: text, threadId: Module["_pthread_self"]() });
}
var err = threadPrintErr;
self.alert = threadAlert;

Module["instantiateWasm"] = (info, receiveInstance) => {
    var module = Module["wasmModule"];
    Module["wasmModule"] = null;
    var instance = new WebAssembly.Instance(module, info);
    return receiveInstance(instance);
};

self.onunhandledrejection = (e) => {
    throw e.reason ?? e;
};

function handleMessage(e) {
    try {
        if (e.data.cmd === "load") {
            let messageQueue = [];
            self.onmessage = (e) => messageQueue.push(e);
            self.startWorker = (instance) => {
                Module = instance;
                postMessage({ cmd: "loaded" });
                for (let msg of messageQueue) {
                    handleMessage(msg);
                }
                self.onmessage = handleMessage;
            };
            Module["wasmModule"] = e.data.wasmModule;
            for (const handler of e.data.handlers) {
                Module[handler] = (...args) => {
                    postMessage({ cmd: "callHandler", handler: handler, args: args });
                };
            }
            Module["wasmMemory"] = e.data.wasmMemory;
            Module["buffer"] = Module["wasmMemory"].buffer;
            Module["ENVIRONMENT_IS_PTHREAD"] = true;

            if (typeof e.data.urlOrBlob == "string") {
                // Normal case: we got a URL string — just importScripts it directly.
                importScripts(e.data.urlOrBlob);
            } else {
                // We received a Blob (Emscripten embeds the JS source as a Blob when
                // the worker can't determine its own URL, e.g. inside a Vite bundle).
                //
                // SES/MetaMask lockdown wraps the Blob constructor so that native
                // URL.createObjectURL() rejects it with "Overload resolution failed".
                // We catch that error and fall back to loading web-ifc-api.js from
                // its known static URL (copied to /web-ifc-api.js via /public/).
                try {
                    var objectUrl = URL.createObjectURL(e.data.urlOrBlob);
                    importScripts(objectUrl);
                    URL.revokeObjectURL(objectUrl);
                } catch (_sesError) {
                    // SES/Lockdown fallback: load the static copy from /public/
                    importScripts("/web-ifc-api.js");
                }
            }

            WebIFCWasm(Module);
        } else if (e.data.cmd === "run") {
            Module["__emscripten_thread_init"](e.data.pthread_ptr, 0, 0, 1);
            Module["__emscripten_thread_mailbox_await"](e.data.pthread_ptr);
            Module["establishStackSpace"]();
            Module["PThread"].receiveObjectTransfer(e.data);
            Module["PThread"].threadInitTLS();
            if (!initializedJS) {
                Module["__embind_initialize_bindings"]();
                initializedJS = true;
            }
            try {
                Module["invokeEntryPoint"](e.data.start_routine, e.data.arg);
            } catch (ex) {
                if (ex != "unwind") {
                    throw ex;
                }
            }
        } else if (e.data.cmd === "cancel") {
            if (Module["_pthread_self"]()) {
                Module["__emscripten_thread_exit"](-1);
            }
        } else if (e.data.target === "setimmediate") {
            // No-op
        } else if (e.data.cmd === "checkMailbox") {
            if (initializedJS) {
                Module["checkMailbox"]();
            }
        } else if (e.data.cmd) {
            err("worker.js received unknown command " + e.data.cmd);
            err(e.data);
        }
    } catch (ex) {
        if (Module["__emscripten_thread_crashed"]) {
            Module["__emscripten_thread_crashed"]();
        }
        throw ex;
    }
}

self.onmessage = handleMessage;
