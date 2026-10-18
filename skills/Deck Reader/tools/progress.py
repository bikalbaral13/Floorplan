"""Live progress for the pipeline app. A script prints one line the pipeline runner turns into
stages/S<n>/progress.json (progress/1):   @@progress {"pct": 40, "msg": "Reading slide 4 of 10"}

    from progress import report
    report(40, "Reading slide 4 of 10")
"""
import json


def report(pct, msg):
    print("@@progress " + json.dumps({"pct": round(float(pct), 1), "msg": str(msg)}), flush=True)
