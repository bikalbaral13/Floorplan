import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// NO PRE-SEEDED TOKEN. A JWT literal used to be written here on first load so PublicRoute would bounce
// past /signin and the app would come up "logged in". It expired on 11 April, after which every platform
// call returned 401 from a server that was answering correctly — and because the token was still present,
// nothing ever concluded that the session was over. A credential with an expiry does not belong in the
// bundle; sign in at /signin and the real token lands in localStorage under the same key.
//
// Nothing is locked away by removing it: ProtectedRoute renders its children unconditionally, so the
// editor still opens. What changes is that /signin is now reachable, and a 401 leads there.
createRoot(document.getElementById("root")!).render(<App />);
