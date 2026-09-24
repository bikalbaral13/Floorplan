#!/usr/bin/env node
// The bridge now lives in packages/floorplan-bridge (published as @builderpluss/floorplan-bridge).
// This shim keeps `node mcp/floorplan-bridge.mjs` (.mcp.json, skills, docs) working.
import "../packages/floorplan-bridge/floorplan-bridge.mjs";
