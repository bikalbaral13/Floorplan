# Innova Design

A browser-based design and architecture workbench for floor plans, BIM models, and parametric layout generation. Built with React, TypeScript, and Vite, it combines a 2D floor plan editor, a 3D/BIM viewer, a node-graph parametric engine, and a suite of computational-geometry algorithms into a single web application.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Available Scripts](#available-scripts)
- [Routes](#routes)
- [Algorithms](#algorithms)
- [The Flow (Node-Graph) Engine](#the-flow-node-graph-engine)
- [Contributing](#contributing)

---

## Overview

Innova Design is a single-page application that brings architectural design tooling into the browser. It is organised around three main pillars:

1. **A 2D Floor Plan Editor** — draw walls, rooms, openings (doors/windows), and place objects on a snapping canvas, with OSM map and PDF underlays for tracing real-world context.
2. **A BIM / 3D Viewer** — load and inspect IFC models, fragments, and meshes, take measurements, and add annotations.
3. **A Parametric Flow Engine** — a visual node-graph editor that drives layout generation, built-up-area (BUA) calculations, setback solving, and object placement from a small set of inputs.

These are backed by an extensive library of computational-geometry algorithms (partitioning, layout optimisation, skeletonisation, vectorisation, and more).

---

## Key Features

- **Floor Plan Editing** — wall drawing with snapping and corner resolution, automatic wall intersection splitting, room detection, doors/windows, and 2D object/furniture symbols.
- **Underlays & Context** — OpenStreetMap overlay and PDF raster underlay for tracing site plans and scaling by area.
- **Layout Generation** — automatic room layouts for rectangular, L-, T-, C-, I-, Z-, cross-, and stepped-shaped footprints, plus rectangle packing and BSP-based partitioning.
- **Parametric Flow Graph** — connect nodes to compute Built-Up Area, solve circular setbacks, run pipe-network solvers, and place objects, with results surfaced in the Properties panel.
- **3D & BIM** — three.js / react-three-fiber rendering and a ThatOpen-based BIM viewer (IFC via web-ifc, fragments, measurements, annotations, GIS).
- **Export** — architectural drawing and DXF export, plus PDF generation.
- **Site & Massing Tools** — BUA calculator, circular setback solver, and set-scale-by-area utilities.
- **Image & Media Tools** — image annotation, panorama viewing, presentation mode, furniture bundle generation, and a Meshy 3D studio.

---

## Tech Stack

| Area | Libraries |
| --- | --- |
| Framework | React 18, TypeScript, Vite 5 |
| Routing | react-router-dom v6 |
| State / Data | @tanstack/react-query |
| UI | Tailwind CSS, Radix UI (shadcn-style components), lucide-react |
| 2D Canvas | Konva, react-konva |
| 3D | three.js, @react-three/fiber, @react-three/drei, three-csg-ts |
| BIM | @thatopen/components, @thatopen/components-front, @thatopen/fragments, @thatopen/ui, web-ifc |
| Node Graph | @xyflow/react |
| Geometry | polygon-clipping, custom algorithms |
| Documents | pdfjs-dist, jspdf, html2canvas, html-to-image |
| ML / Vision | @huggingface/transformers |
| Validation | zod, react-hook-form |

---

## Architecture

The app is a client-side SPA. `src/main.tsx` mounts `App`, which wires up React Query and React Router. `src/Routes.tsx` declares the route table, splitting public routes (sign-in) from a protected layout that hosts the editor and viewer pages.

Two domains carry most of the logic:

- **`src/floorplan/`** — the floor plan editor (`FloorPlanEditor.tsx`), its persistence, geometry helpers (walls, rooms, snapping), the `algorithms/` library, and the `flow/` node-graph engine.
- **`src/bim/`** — the BIM/3D viewer, organised into core, viewer, loaders, tools, measurements, annotations, documents, export, GIS, and integrations.

---

## Project Structure

```
src/
├── api/                  API clients
├── bim/                  BIM / 3D viewer
│   ├── core/             viewer setup & world
│   ├── viewer/           viewer UI
│   ├── loaders/          IFC / fragment loaders
│   ├── tools/            measurement & inspection tools
│   ├── measurements/     measurement logic
│   ├── annotations/      model annotations
│   ├── documents/        document handling
│   ├── export/           export utilities
│   ├── gis/              geospatial overlays
│   └── integrations/     third-party hooks
├── components/           shared & UI components (shadcn/Radix)
├── contexts/             React contexts
├── floorplan/            2D floor plan editor
│   ├── FloorPlanEditor.tsx
│   ├── algorithms/       computational geometry (see below)
│   ├── flow/             node-graph parametric engine
│   ├── components/       editor toolbars, dialogs, panels
│   ├── three/            3D floor plan canvas
│   ├── furniture/        furniture symbols
│   ├── hooks/            editor hooks
│   ├── export/           architectural drawing & DXF export
│   ├── wallGeometry.ts   wall solving
│   ├── roomGeometry.ts   room solving
│   └── osmMap.ts         OSM overlay
├── pages/                route pages
├── hooks/                shared hooks
├── lib/                  utilities
├── types/                shared types
└── utils/                helpers
public/
├── flows/                sample flow graphs (JSON)
└── schemas/              flow node schemas (JSON)
```

---

## Getting Started

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** (or a compatible package manager)

### Installation

```bash
git clone https://github.com/bikal2026/Floorplan.git
cd Floorplan
npm install
```

### Run the dev server

```bash
npm run dev
```

Vite serves the app at **http://localhost:2000/** by default.

---

## Available Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Production build. |
| `npm run build:dev` | Build in development mode. |
| `npm run preview` | Preview the production build locally. |
| `npm run lint` | Run ESLint over the project. |

---

## Routes

| Path | Page |
| --- | --- |
| `/signin` | Sign in |
| `/` | Project list |
| `/projects/:id` | Project detail |
| `/innova-design/:id?` | Image annotation |
| `/building-configurator/:id?` | Building / 3D viewer |
| `/3d-model/:id?` | 3D generation |
| `/panorama` | Panorama viewer |
| `/presentation/:id?` | Presentation mode |
| `/bim` | BIM viewer |
| `/meshy/:id?` | Meshy 3D studio |
| `/image-api-processor/:id?` | Image API processor |
| `/floorplan-editor` · `/floorplan-editor/:projectId` | Floor plan editor |

---

## Algorithms

The `src/floorplan/algorithms/` directory holds the computational-geometry library that powers layout and editing:

- **geometry/** — polygon operations: splitting, clipping, meshing, insets/pull, column clipping, and related helpers.
- **layout/** — automatic room layout solvers for Rect, L, T, C, I, Z, Cross, and Stepped footprints, plus rectangle packing and in-circle placement.
- **partitioning/** — space partitioning, including BSP (basic and advanced), convex decomposition, and rectilinear Voronoi.
- **walls/** — wall corner resolution and splitting walls at intersections.
- **skeleton/** — medial-axis / skeleton extraction.
- **vector/** — raster-to-vector image tracing.
- **network/** — pipe-network solving.
- **vision/**, **semantics/**, **placement/**, **dcr/** — supporting passes for recognition, semantics, object placement, and design-constraint resolution.

---

## The Flow (Node-Graph) Engine

`src/floorplan/flow/` implements a visual, parametric node-graph (built on `@xyflow/react`):

- `FlowOverlay.tsx` — the graph canvas overlaid on the editor.
- `compileFlow.ts` / `eval/` — compiles and evaluates the graph (`evaluateFlow`, `evalNodes`, `vectorUnion`).
- `flowTypes.ts` — node and value type definitions.
- `bua.ts` — Built-Up Area pipeline.
- `conditional.ts` — conditional node logic.
- `FlowParamsPanel.tsx`, `InputPropsEditor.tsx`, `SchemaNodeEditor.tsx`, `PlaceObjectEditor.tsx` — editors for node parameters; connected-node parameters surface in the Space Properties panel.

Bundled assets live under `public/Library/` — flow graphs in `Library/Flows/`, exported canvas designs in `Library/Designs/`, and parametric objects in `Library/Parametric Objects/` (`Canvas` / `Nodes` / `Segments` / `Spaces` subfolders, loaded by the toolbar's Import Objects). The built-in workflow templates (Floorplan Tracer, Parametric Floorplan, Layout Generation, Site Massing, Parametric Workflow, Structural Template, Pipe Network Solver, Watershed Delineation) ship as JSON files in `Library/Flows/` and load from the Flow editor's **Import** dropdown (the old right-rail templates tab was removed). New flows, designs, and objects always go in the matching `public/Library/` subfolder. Node schemas live in `public/schemas/`.

---

## Contributing

This is a private project. To contribute:

1. Create a feature branch off `main`.
2. Run `npm run lint` and ensure the build passes (`npm run build`).
3. Open a pull request describing the change.

---

_Built with React, TypeScript, Vite, three.js, and ThatOpen Components._
