# 合约 C-world-adapter

大版本：2 · 提供方 adapter · 使用方 canvas（只往后追加，旧内容不改；SCHEMA 1.25）

- 调用 ReadWorldSourceCapabilities：canvas → adapter；入 ReadWorldSourceCapabilitiesRequest；出 能力清单（owner 写角色 world-source，不写包名）：geometryProfiles（本大版本只有 voxel-grid/v1）、partition.edge、engineBounds、StateProfile 字段规则（哪些由引擎派生不参与比对、哪些写入时保留、哪些清空）、postWriteLighting（required/none）、不透明 writeBackend{profileId, revision} 与编译配置、支持的写入方式、写路径结论 hasSideEffects/hasPersistentState、可覆盖的 guard（EngineGuardDeclaration）、玩家身体包络；错误 ADAPTER_UNAVAILABLE
- 调用 ListWorlds：canvas → adapter；入 ListWorldsRequest；出 ListWorldsResponse；错误 ADAPTER_UNAVAILABLE
- 调用 ReadLocalConnection：canvas → adapter；入 LocalConnectionReadbackRequest；出 LocalConnectionReadbackResponse；错误 CONNECTION_NOT_FOUND、PAYLOAD_VERSION_MISMATCH
- 调用 InspectRegion：canvas → adapter；入 InspectRegionRequest（带 geometryProfile；坐标在世界源声明的几何 profile 内）；出 InspectRegionResponse（足迹带 geometryProfile；不可读原因为世界源给的不透明 unknownReason 码）；错误 WORLD_NOT_BOUND、CAPABILITY_UNAVAILABLE、CAPABILITY_GAP
- 调用 PrepareRecoverableTransaction：canvas → adapter；入 ScopedPrepareRequest；出 ScopedPrepareResponse；错误 TRANSACTION_CONFLICT、WORLD_NOT_BOUND
- 调用 ApplyCompiledTransaction：canvas → adapter；入 ScopedApplyRequest（带 geometryProfile；逐格操作：不透明 materialRef + 中立朝向索引）；出 ScopedApplyResponse；错误 APPLY_FAILED、REPLAY_MISMATCH、CAPABILITY_GAP
- 调用 Readback：canvas → adapter；入 ReadbackRequest；出 ReadbackResponse（记录带 geometryProfile：locus、materialRef、orientation、不透明 state；按 StateProfile 声明比对）；错误 READBACK_FAILED
- 调用 RestoreTransaction：canvas → adapter；入 RestoreTransactionRequest（before 图像带 geometryProfile）；出 RestoreTransactionResponse；错误 RESTORE_FAILED
- 调用 ReadRegion：canvas → adapter；入 ReadRegionRequest（按世界源能力声明的分块，先加载再读）；出 ReadRegionResponse（带 geometryProfile；不可读原因为不透明码）；错误 CAPABILITY_UNAVAILABLE
- 调用 WriteRegion：canvas → adapter；入 WriteRegionRequest（带 geometryProfile；按世界源声明的分块批量写；用什么引擎 API 写由 adapter 内部决定，D-15 不用 WorldEdit）；出 WriteRegionResponse（postWriteLighting=required 时附光照结果）；错误 APPLY_FAILED、CAPABILITY_GAP
