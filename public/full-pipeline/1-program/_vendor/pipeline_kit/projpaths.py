"""Where a project's files live in R2 — the one place that knows the Projects/<CODE>/ layout
(Projects/project_creation.md). Every writer (sync, state, the Full Pipeline's project.py) builds keys here.

    Projects/<PROJECT>/project.json                        the project manifest
    Projects/<PROJECT>/inputs/<kind>/                      what the user / client gives (read-only for pipelines)
    Projects/<PROJECT>/<n-phase>/<pipeline>/[<SUB>/]       one pipeline's folder: run.json, state.json, steps/, output/
    Projects/<PROJECT>/handoff/<phase>.json                what a finished phase hands the next one
    Projects/<PROJECT>/shared/                             the packed project canvas + its revisions
    Projects/<PROJECT>/media/<kind>/                       client-facing renders, video, drawings
    Projects/<PROJECT>/archive/<stamp>/                    superseded runs

<SUB> is a pipeline project inside the project (one floor: DEMO_VILLA_GF); it is left out when it equals <PROJECT>.
Placeholders in pipeline.json outputs.keep[].to: {DIR} {OUT} {STEPS} {PROJECT} {CODE} (= the SUB, or the project)."""

PHASE_DIRS = {"program": "1-program", "plan": "2-plan", "build": "3-build", "present": "4-present"}
ALIASES = {"design": "plan", "plan/design": "plan"}
KNOWN = {"program": "program", "floorplan-tracer": "program", "site-checklist": "program", "space-brief": "plan",
         "build-from-deck": "build", "walkthrough-video": "present"}
INPUT_KINDS = ("drawings", "decks", "images", "designs", "models", "shared")
MEDIA_KINDS = ("renders", "video", "drawings")


def phase_of(pipeline, declared=None):
    """program | plan | build | present for a pipeline (its pipeline.json `phase`, else the known table, else program)."""
    p = ALIASES.get(str(declared or "").lower(), str(declared or "").lower())
    return p if p in PHASE_DIRS else KNOWN.get(pipeline, "program")


def root(project): return f"Projects/{project}/"
def manifest(project): return f"Projects/{project}/project.json"
def inputs(project, kind=""): return f"Projects/{project}/inputs/" + (f"{kind}/" if kind else "")
def handoff(project, phase): return f"Projects/{project}/handoff/{phase_of('', phase)}.json"
def shared(project): return f"Projects/{project}/shared/"
def media(project, kind=""): return f"Projects/{project}/media/" + (f"{kind}/" if kind else "")
def archive(project, stamp): return f"Projects/{project}/archive/{stamp}/"


def pipeline_dir(project, pipeline, sub=None, phase=None):
    base = f"Projects/{project}/{PHASE_DIRS[phase_of(pipeline, phase)]}/{pipeline}/"
    return base + (f"{sub}/" if sub and sub != project else "")


def expand(s, project, pipeline, sub=None, phase=None):
    d = pipeline_dir(project, pipeline, sub, phase)
    return (s.replace("{DIR}", d).replace("{OUT}", d + "output/").replace("{STEPS}", d + "steps/")
             .replace("{PROJECT}", project).replace("{CODE}", sub or project))
