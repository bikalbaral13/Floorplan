"""Put the pipeline root on sys.path from anywhere inside it (or from an explicit path)."""
import os, sys

def boot(start=None):
    d = os.path.abspath(start or os.path.dirname(__file__))
    while not os.path.exists(os.path.join(d, "PIPELINE_ROOT")):
        if os.path.dirname(d) == d:
            raise FileNotFoundError("PIPELINE_ROOT not found")
        d = os.path.dirname(d)
    if d not in sys.path:
        sys.path.insert(0, d)
    return d
