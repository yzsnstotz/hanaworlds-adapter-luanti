# Independent native Frame calibration (Q-144 / D-62)

The oracle runs in the source checkout and one normally packed artifact,
installed with pnpm's default strict policy. Expected handedness never comes
from `canvas-facts.json`, `ReadEngineFacts.frame`, Adapter source literals,
the Frame schema, or a mock native response.

The external physical reference is Luanti's documented right/up/forward
convention. Physical **right/up/backward** is the right-handed reference used
for signed volume. Sources: the official [coordinate convention](https://api.luanti.org/coordinate-system/),
[native node rotations](https://api.luanti.org/nodes/), and versioned
[Luanti 5.17 API](https://github.com/luanti-org/luanti/blob/5.17.0/doc/lua_api.md)
(Coordinate System, node `facedir`/`wallmounted`, direction conversion APIs).
Three axis names alone do not establish this physical reference convention.

The native observer calls the running engine's `core.yaw_to_dir` at 0 and both
quarter-turns, `core.facedir_to_dir` for all four horizontal node orientations,
and `core.wallmounted_to_dir(0)` for up. It records engine version and returned
directions. The oracle checks unit length, orthogonality, agreement of yaw's
negative quarter-turn with the node's first quarter-turn, and opposite second
and third turns. Forward/right/up come from these actual direction results;
expected data does not copy native helper implementation tables.

Four signed, nonzero, distinct-axis coordinates form a nondegenerate
tetrahedron. Nodes and metadata markers are initialized before read audits,
then observed independently. Public `readScopedState` must round-trip them
through the actual courier, payload and snapshot conversion. Differences from
the first returned native vertex are projected onto `(right, up, -forward)`.
Divide that signed volume by the requested neutral tetrahedron's signed volume:
positive means right-handed, negative means left-handed. This measures actual
conversion orientation, independently of the Frame declaration. Origin and
signed axis permutations are also checked against every returned position,
including an inverse round trip. The normal public Frame's handedness must
equal this measured result.

`handedness-and-recovery` first reads/calibrates the normal public Frame, then
changes only `frame.handedness` in the installed world's normal declaration.
Origin, axes, transform revision, unit and production coordinate implementation
stay unchanged. The changed file must reach the real native source and public
Frame, with its byte revision and other facts verified. The same independent
calibration must throw the specific handedness mismatch **test assertion**;
this does not add a production error code or wire ABI. Restoring the original
bytes must recover the entire public result and pass full calibration again.

All public reads, including changed/restored declarations, audit native writes,
emerge, lighting, nodes, histories and bindings for zero changes. Passive
recording never replaces native bytes or source functions. No source fixture,
skip or TODO substitutes for the normal declaration. Before implementation,
missing normal declarations keep public tests RED; separately recorded native
measurements are not successful source facts or an executed file counterexample.
