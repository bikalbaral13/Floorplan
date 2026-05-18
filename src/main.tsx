import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Dev login bypass: pre-seed a token so PublicRoute redirects away from /signin
// and protected routes render without an auth flow.
if (!localStorage.getItem("token")) {
  localStorage.setItem(
    "token",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3ZGE1N2JkZmE2OThhNWFhMzFiMWZkZCIsInVzZXJUeXBlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NzMyOTAxNzMsImV4cCI6MTc3NTg4MjE3M30._4jAm_0FAtGqHEnTFVCstvvHS1hiHtbRlTS2ONbNCFM"
  );
  localStorage.setItem("role", "customer");
}

createRoot(document.getElementById("root")!).render(<App />);
