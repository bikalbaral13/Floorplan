# standards

Byte-identical copies of the firm standards sets in `library/Standards/` (SOURCE.json holds their sha256; the
selftest compares). One file per set holds both the conventions every pipeline uses when a source is silent (walls,
levels, openings, stairs …, metres) and the object preferences this pipeline layers onto typology parameters:
`{"extends": "<SET>", "objects": {"<OBJECT_ID>": {"<object param>": value}}}`. A project chooses a set in
`project.json → standards`; the same set name means the same values in every pipeline (space-brief reads the
conventions, this pipeline the objects). Loader: `pipeline_kit.standards` (extends merge, note keys dropped).

Never edit here — edit the library master, publish with the user's approval, re-copy.
