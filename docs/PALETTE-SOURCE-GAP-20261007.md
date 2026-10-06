# S1-AD-LOCAL-WORLD-01 · 图片材质来源审计

Disposition: SOURCE audit complete; **shared declaration required before implementation**.
Current product game / legal material palette binding: **UNKNOWN**. No new runtime gate,
no new tar/version, no change to Adapter payload or peer implementations.

## 1. 已证实的来源边界

- Audited runtime source: `a590ad82011a8fdecfd00e3cdd49329128279792` (Adapter 0.3.1).
- Existing package-runtime receipt used an isolated **component game fixture**:
  `hw_local`, gameRevision `9dfc0daf2429fa5a7102967cbaaace49b7e0e6d3481f46ccbc0df1c3e4344c2a`,
  Catalogue digest `22ec3170ebbacfd0393ffa2cba82fc69d81f8bedcc4ae1eb89ccfeec5c32e716`;
  nodes `air`, `base:stone`, `base:unused_fixture`, `ignore`, `worldedit:placeholder`.
  `base:stone.allowedParam2`, `collisionBoxes`, `hasPersistentState` are unknown.
  This is recorded REAL_RUNTIME with explicit Host fixture, not product game evidence.
- Fixed text candidate's **public file manifest** has 21,316 entries and zero paths
  ending `game.conf` or containing `/games/`. This is only a path-list observation,
  not an inspection of App contents, nested archives or selected runtime world.
  Its receipt identifies the engine binary, not a selected game; its real-world
  building/Undo and model/App runtime remain NOT_RUN. Adapter discovers supplied
  localWorldRoots / world.mt gameid; it does not select/install a product game.
- Painter's public REPORT measured 63 explicit VoxeLibre 0.92.3 texture associations.
  The map digest is `2b803d65e17da8b7b85b8bbc4a610976729c21f438149d9480279dc2cb00f137`,
  game.conf digest `1a22b041985f98228323e3e1136e8836f5f6287d86d732ae00ea1676efb46289`,
  measured-data digest `9bf82ae1ad3cba6e7f48a26c0a2ad6fe2963be9d2d20e195931dbd47e2ffef60`.
  These describe its measured input, not the current product world. No `base:*`
  alias, name-based colour, game version guess or fixture material substitution.

## 2. 当前公开口及真实缺口

`ctx.get('hanaworldsLuantiNativeFacts').readCatalogue(worldRef)` returns the full
contracts 0.4.0 `Catalogue` directly. Desktop may bind Workshop's existing
`hanaworldsCatalogue.read(worldRef)` to it. `src/local-runtime.mjs:37` checks the
actual paired world/native process before and after the read. `src/index.mjs:31`
publishes this service. No peer private engine/rows access is necessary.

`payload/hanaworlds_adapter/facts.lua:51` obtains the loaded `get_game_info().id`,
`get_modnames()` and complete `registered_nodes`. Its gameRevision is a fingerprint
of names, known capability scalar fields and callbacks, **not game release / game
files / texture bytes**. Node definitionRevision and modRevisions also omit texture
data. Thus a different texture can leave these fingerprints unchanged. Existing
payloadDigest covers the Adapter's six Lua files, not the game assets.

The vendored public schema rejects extra fields on both Catalogue and NodeCapability.
Neither has texture references, resource byte digests, measured colour or source
association. Resource describes artifact identity/digest/size/purpose, with only
BUILD_PAYLOAD, BUILD_MEDIA_REQUIRED, HISTORY_BEFORE_IMAGE and HISTORY_READBACK
purposes. It provides neither a material-to-texture relation nor a current-world
texture byte supplier. MediaBinding describes user attachments, not game assets.
Adding a private property or misusing BUILD_MEDIA_REQUIRED would not close the gap.

## 3. 给原 Contracts worker 的最小公开声明建议

This is a requested shared declaration, **not an implemented/new private wire**.
Keep the same in-process NativeFacts service and current-world boundary. A minimal
readonly `readMaterialSources(worldRef)` response can carry:

| 字段 | 原生来源/约束 |
| --- | --- |
| worldRef, connectionIncarnationRef | Adapter 当前 paired row；前后关联验证，不能由模型填入 |
| catalogueDigest, gameId, gameRevision | 同一原生 registry 快照；复用现有 Catalogue 与 digest 规则 |
| sourceRevision | 对下面节点关联及实际读取的 texture byte digests 的规范摘要；不能复用 registry 指纹充当 texture revision |
| materials[].nodeName, param2, definitionRevision | 同一 registered_nodes；param2 必须符合该 node 的实际 paramtype2 与已知合法集合，不能从名字猜 |
| materials[].textureName, sourceKind | 实际 tiles 声明及已解析的 server/game/mod asset 来源；不以 inventory_image 替代建筑面纹理 |
| materials[].bytesDigest, mediaType, byteLength, textureBytes | 实际解析文件的字节与 SHA256；textureBytes 为 in-process Uint8Array，Contracts 声明校验约束，不把 TypedArray 塞进 JSON wire |
| materials[].availability, unknownReason | KNOWN 或 UNKNOWN；未知时 texture facts 为 null，显式原因；不能返回 placeholder colour/bytes |

Use raw texture bytes as the narrow delivery option: Painter already owns pixel
measurement, so Adapter need not add RGB measurement or a second colour pipeline.
The bytes must be accompanied by exact node/param2 and sourceRevision binding.
Contracts owns final type/method declaration and canonical digest rules, including
whether textureBytes is an out-of-band typed service value. Host must consume that
public shape, bind it to the same selected world/Catalogue and pass the matching
source to Painter; no Host/Painter implementation is changed in this audit.

Existing NodeCapability.allowedParam2 can express known legality without another
permission/authorization protocol. Today it is null; declare/derive only supported
native paramtype2 cases after checking actual game definitions. Keep other static
capability unknowns truthful: a texture association alone cannot make Painter's
static-material validation pass. No hardcoded singleton param2 or synthetic boxes.

For the MVP, KNOWN can be limited to independently resolved simple texture assets
with known param2 semantics; unresolved modifiers, overlays, tint/palette, duplicate
resolution or source overrides remain UNKNOWN. A texture name alone is insufficient.
Reuse a measured index entry only when its explicit node/param2 **and actual texture
digest/source interpretation** match; VoxeLibre version/name equality alone is not
proof. This does not require implementing a generic client renderer/texture engine.

## 4. 可用原生来源（官方 5.17.0 API；未冒充本轮运行回执）

[Luanti 5.17.0 Lua API](https://github.com/luanti-org/luanti/blob/5.17.0/doc/lua_api.md)
documents game identity/root via get_game_info, mod roots via get_modpath, node
tiles/paramtype2/palette and texture lookup priorities/modifiers. These are the
inputs for a later own-origin readonly implementation. Loaded game metadata and
resolved bytes need to be read from the paired runtime, not a remembered install.
Server/game/mod and client overrides can differ; declare the measured source basis
and leave an unverified rendered client appearance UNKNOWN. This audit asserts
neither a resolved current-world file nor client texture-pack equivalence.

## 5. 证据、下一步、保护与清理

Reproducible SOURCE audit (reads only public receipts and own source/schema):

```sh
python3 scripts/audit-palette-source.py --runs /Users/yzliu/.cache/hanaworlds-runs --output /Users/yzliu/.cache/hanaworlds-runs/S1-AD-LOCAL-WORLD-01/_evidence/palette-source-audit-new
```

Use a new output directory; it refuses to overwrite existing evidence.
Executed output: `/Users/yzliu/.cache/hanaworlds-runs/S1-AD-LOCAL-WORLD-01/_evidence/palette-source-20261007/receipt.json`.
SHA256 `7580930506bf43a7ea41d218084daf027844e0ff6fdf4f15331b47c6947402b9`.
It records every input path/hash, schema fields, observed fixture, engine receipt,
manifest check and NOT_RUN boundary. Command exit 0; no runtime startup or GUI.

Next: PM coordinates the original Contracts writer's minimal declaration, then
resumes this same Adapter writer for a narrow public implementation and affected
source/package/real Luanti proof. The actual selected product game must eventually
be evidenced through the real product connection; it is not determined by this
component fixture. No owner decision or new worker is requested.

Protected package stays 0.3.1, SHA256
`ba88047a8c0f8845bd042d1fc3a03bc5a4e6b106ef3b41649ebae50d604882eb`;
payload stays `a26d8bf558dfbf2f8d10ad0b31d050ae896f025c6f5344b285ccd2df8586b268`.
No old admission/eight/eleven gates rerun. Formal image App/model/world/Undo NOT_RUN.
构建清理：本轮未构建、装依赖、启动进程或新建运行 profile，无用毕依赖/提取树；
删除 0 bytes。仅新增自身审计脚本/文档和必要 E；固定包、文字候选、原源码/E/world 保留。
