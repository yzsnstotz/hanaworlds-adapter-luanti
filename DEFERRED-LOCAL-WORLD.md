# Retained Adapter work outside the local-world MVP

Protected prior input: source8146f000fd57b5b3bd69b3b82e217743c8d0ee9f / Adapter0.2.9,
with the lifecycle0.2.8/0.2.7 payload history and its original reports/evidence.
The old v2/v3/v4/v5 ports, transactions, remote transport, grant/AUTO/session
binding modules and their tests remain in the source history/checkout. They are
not imported by src/index.mjs and are excluded from the 0.3.0 npm file list.
Owner1dae1b9fc removed the player permission system from MVP; restoring it needs
a new scope/card and reference to that preserved history, not a duplicate chain.

The current npm scripts select the local-world normal path/core checks. Retained
old-wire fixtures do not validate the new 0.4.0 package. The expanded reentry,
timeout, RPC recovery, replay/concurrency and remote counterexample matrix is
DEFERRED for a later pre-release validation card. Formal App composition, model,
real UI and product same-build Undo require their existing separate gates.
