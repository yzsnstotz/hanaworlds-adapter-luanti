# 合约 C-world-facts

大版本：2 · 提供方 adapter · 使用方 canvas、desktop-bridge、workshop（只往后追加，旧内容不改；SCHEMA 1.25）

- 调用 ReadCatalogue：canvas → adapter；入 ReadCatalogueRequest（世界引用）；出 材质词表（世界源自有）：每项 materialRef（不透明）、显示名、颜色（D-16）、中立标签 passable/liquid/hazardPerSecond/emitsLight/placeable/orientations[]；emptyMaterialRef；中立朝向索引（与引擎编码互转只在世界源）；原始引擎字段只在不透明扩展里；不透明 engineRevisions；错误 ADAPTER_UNAVAILABLE、WORLD_NOT_BOUND
- 调用 ReadMaterialSources：desktop-bridge → adapter；入 ReadMaterialSourcesRequest（世界引用）；出 材质来源与颜色（供 painter 图片选材，经 workshop 带入；不含引擎名）；错误 CAPABILITY_UNAVAILABLE
- 调用 ReadEngineFacts：workshop → adapter；入 ReadEngineFactsRequest（世界引用）；出 geometryProfiles、partition.edge、engineBounds、Frame（axes、gridUnit）、postWriteLighting、支持的写入方式、不透明 writeBackend；错误 ADAPTER_UNAVAILABLE
- 调用 ReadWriteProfile：desktop-bridge → adapter；入 ReadWriteProfileRequest（世界引用）；出 不透明 writeBackend + 完整编译配置 + 支持的写入方式 + 玩家身体包络（bridge 只转交，不解读、不补默认值）；错误 ADAPTER_UNAVAILABLE、CAPABILITY_UNAVAILABLE
