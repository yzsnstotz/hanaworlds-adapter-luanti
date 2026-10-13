# C-world-facts 大版本 2：Canvas 当前世界公开事实读取（追加稿）

提供方 adapter，能力 owner 为 world-source；使用方为当前注册的 Canvas。只追加现有 `hanaworldsWorldFacts` 的本地 Host 方法 `readCanvasFacts(scope)`，不增加 wire 操作、事件、握手能力或同步 guard，不改变任何既有方法或错误。现有 `world-facts/v1.call` 四种操作和 `readScopedState` 保持。没有新事件；来源变化在本次读前后检查，下一次读取获得新事实。

## 调用与身份

`scope = {worldRef: Ref, connectionRef: Ref, connectionIncarnationRef: Ref}`，三个非空不透明引用均必填、禁止额外字段。不是可由 JSON 传入的 provider 身份或权限。它们必须指向同一个已配对的当前连接。未知连接拒绝 WORLD_NOT_BOUND；已知连接但世界/连接代际不符拒绝 CURRENT_WORLD_MISMATCH。

只能从官方 Cordis 同一 root 中当前注册 `hanaworldsCanvasV5` provider 的真实 context 读取。按实例、注册记录、fiber、root 和追踪 receiver 判定，插件名可以变化。读取前及读取后验证 Canvas 与 `hanaworldsWorldFacts` 两个当前 provider 的注册身份；捕获方法、同名替换、disposed fiber、外 root、伪 receiver 均不授予权限。生命周期控制和当前连接仍按已有配对路径验证，连接/绑定不改变。

## 成功字段（全部必填，禁止额外字段）

`CanvasSourceFacts = {profileVersion:'canvas-source-facts/v1', connection:MaterialSourceConnection, provider:FactsProviderIdentity, tools:CanvasToolFacts[], unit:SourcedGridUnit, frame:SourcedFrame, partition:SourcedPartition, sourceRevision:Digest}`。

- connection：实际 worldRef / connectionRef / connectionIncarnationRef，与 scope 完全一致。
- provider：`{providerRef:Ref, providerRevision:Ref}`，由实际 world-source 实例生成的不透明身份与代际，生命周期内稳定、替换实例必须变化；不以包名或版本充当实例身份，不由调用者提供。
- tools：非空、按 toolRef 字典序排列且唯一，覆盖当前世界声明的完整工具清单；每项 `{toolRef:Ref, purpose:SourcedText, typicalScale:SourcedScale}`。
- `Sourced<T> = {value:T, source:FactSource}`。`FactSource = {kind:'LOADED_WORLD_DECLARATION'|'NATIVE_OBSERVATION', factRef:Ref, revision:Ref}`。factRef/revision 是世界源维护的不透明来源引用/内容代际。没有本机路径、引擎节点名或可供消费者解码的原生字段；不可从调用者 JSON、包身份、fixture 或默认值合成来源。
- purpose.value：非空文字，实际加载的世界声明中的工具用途。
- typicalScale.value：`{size:RegionSize, unit:Ref}`，实际加载声明中的典型 x/y/z 尺寸；size 为三个正整数，unit 必须与 unit.value.name 相同。是典型用法说明，不是写入上限；不从 transport budget、engineBounds、身体尺寸或 partition 推断。
- unit.value：已有 GridUnit `{name:Ref, metersPerGridUnit:PositiveFinite|null}`。null 仅表示来源明确未给出物理换算；不把一个 grid unit 默认为一米。命名单元必有来源。
- frame.value：完整已有 Frame `{profileVersion:'frame/v2', frameId:Ref, origin:Position, axes:Axes, handedness:Handedness, gridUnit:GridUnit, transformRevision:Revision}`；gridUnit 必须与 unit.value 一致。原点、轴顺序、手性、单位及变换代际来自加载声明及其对应坐标转换实现证据，不能复用 ReadEngineFacts 中固定值冒充观测。
- partition.value：已有 Partition `{edge:RegionSize}`，实际运行中原生分区观测；kind 必须 NATIVE_OBSERVATION。必须与同次读取的 regionLimits 一致，且在此世界源支持的几何语义内，不能直接填 WORLD_GEOMETRY 常量。
- sourceRevision：上述 body（除 sourceRevision 自身）的 canonical JSON 的 SHA256；所有值和来源均入摘要。摘要/来源 revision 改变不能继续返回此前事实。

Adapter 根声明导出 `CanvasFactsScope`、`CanvasSourceFacts`、`FactsProviderIdentity`、`FactSource` 及 `WorldFactsHostPort.readCanvasFacts(scope):Promise<CanvasSourceFacts>`；结构、schema、校验器与生产声明由插件自有输入编译，不新建合约包或同步 guard。内部 native `sourceDeclaration().canvasFacts` 携带 `{tools,unit,frame,partition}` 的上述 sourced 形状，Host 加入真实连接、provider 身份及整体摘要。缺 native 声明是来源阻塞，不能实现永远拒绝的空口。

## 错误与零副作用

沿用既有公开 JSON Error (`code/phase/retryability/mutationState/transactionRef/causeCode/reason`，可选 worldRef/source)。mutationState 必为 NONE；transactionRef 为 null。消费者按 publicError 字段使用，不共享异常构造器。

|情况|code|
|---|---|
|缺 scope、坏输入类型/形状、坏完整值|SCHEMA_INVALID|
|未知额外字段（请求或原生声明）|UNKNOWN_REQUIRED_FIELD|
|未知/未配对连接|WORLD_NOT_BOUND|
|关闭 Adapter|ADAPTER_UNAVAILABLE|
|伪造/跨 root/未注册/注销/替换任一 provider|CAPABILITY_UNAVAILABLE|
|已知连接但 world/incarnation 不符、读取中范围或来源变动|CURRENT_WORLD_MISMATCH|
|原生分区不符合当前源支持的几何语义|CAPABILITY_GAP|
|缺任一工具用途、典型规模、单位、Frame、partition 或其来源|TARGET_FACTS_INCOMPLETE|
|原生 payload/版本不匹配|PAYLOAD_VERSION_MISMATCH|

缺事实的 retryability 为 AFTER_NEW_FACTS、reason 为 REQUIRED_FACT_UNKNOWN；恢复真实来源后同一个口可以成功。既有原生读取的具名错误和有效 FailureSource 保留。无重试、超时扩展、旧别名 fallback。零世界写、transaction prepare、history mutation、connection/binding change；不得为读声明调用 emerge/生成新区块。并不承诺 Q42/Q61/Q62 同步或跨调用稳定性。

## 完整示例（合约数据，不是实际世界来源证据）

```ts
const facts = ctx.get('hanaworldsWorldFacts'); // 当前注册 Canvas 的真实 context
const scope = {worldRef:'W',connectionRef:'C',connectionIncarnationRef:'I'};
const value = await facts.readCanvasFacts(scope);
// 完整正常结果（sourceRevision 按上文算法计算）：
const D = {kind:'LOADED_WORLD_DECLARATION',factRef:'world-declaration:17',revision:'r7'};
const N = {kind:'NATIVE_OBSERVATION',factRef:'partition-observation:3',revision:'r9'};
const body = {
  profileVersion:'canvas-source-facts/v1',connection:scope,
  provider:{providerRef:'opaque-provider-instance:1',providerRevision:'opaque-generation:1'},
  tools:[{toolRef:'tool:fill',purpose:{value:'填充选定区域',source:D},
    typicalScale:{value:{size:[7,5,9],unit:'world-cell'},source:D}}],
  unit:{value:{name:'world-cell',metersPerGridUnit:null},source:D},
  frame:{value:{profileVersion:'frame/v2',frameId:'frame:world',origin:[0,0,0],
    axes:['+X','+Y','+Z'],handedness:'left',gridUnit:{name:'world-cell',metersPerGridUnit:null},
    transformRevision:'r7'},source:D},
  partition:{value:{edge:[16,16,16]},source:N}
};
// CanvasSourceFacts = {...body, sourceRevision:SHA256(canonicalJSON(body))}
try { await facts.readCanvasFacts({...scope,worldRef:'other-world'}); }
catch (e) {
  // e.publicError = {code:'CURRENT_WORLD_MISMATCH',phase:'validate',
  // retryability:'AFTER_NEW_FACTS',mutationState:'NONE',transactionRef:null,
  // causeCode:null,reason:'REQUIRED_FACT_UNKNOWN'}
}
// 正常当前范围但 world-source 尚缺 typicalScale.source：
// {code:'TARGET_FACTS_INCOMPLETE',phase:'validate',retryability:'AFTER_NEW_FACTS',
// mutationState:'NONE',transactionRef:null,causeCode:null,reason:'REQUIRED_FACT_UNKNOWN'}
// capturedRead 在同名 Canvas/facts provider 被替换后：CAPABILITY_UNAVAILABLE。
// 三个例子均没有连接、历史或世界写副作用。
```

验收测试进入现有 test:contracts / npm test 的 scoped-state-port；生产 tgz 真实默认严格安装和全部原有破损 tgz / 管理器策略负例保持。真实 Luanti 及实际声明证据单列，不能把示例升级成真实来源。

## Q-141 / D-61：正常载荷声明及真实测试输入

本卡负责来源，不能再将自有声明当作等待 PM/对端补供的缺口。
正常打包/安装的载荷包含 `payload/hanaworlds_adapter/canvas-facts.json`，
并由正常 payload 安装器复制到当前世界的载荷目录。声明纳入 payload 文件清单、
安装/摘要及正常制品资源闭包；不得仅出现在测试、手工注入或另一个未安装的源码目录。

文件结构由 world-source 自有：
`{profileVersion:'canvas-declaration/v1', tools:[{toolRef,purpose,typicalScale:{size,unit}}], unit:GridUnit, frame:Frame}`。
字段全部必填、工具清单非空/排序/唯一；用途是非空文字、规模是三个正整数的明确声明，
不是引擎/预算推导。这里没有 sourced 包装：原生读取后由世界源添加包装。

每次实际 `fact_world_source` 读取当前世界副本的原始 UTF-8 字节；声明字段的
`FactSource.revision` 是这些实际加载字节的 SHA256（包含原始格式，不用重新序列化代替）。
`factRef` 为字段的世界源不透明来源引用；世界/连接/代际仍通过真实配对范围绑定。
分区不放进该 JSON 冒充声明值，而从运行中 MAP_BLOCKSIZE 观测；其来源为 NATIVE_OBSERVATION。
正常 Frame 必须与实际坐标转换实现一致，不能仅从声明重复复制一个错误的 Frame。

公开读前/后均有本次真实 courier→payload 来源观测。缺文件或任一声明字段/来源缺失为
TARGET_FACTS_INCOMPLETE；读取期间内容 revision 变化为 CURRENT_WORLD_MISMATCH。
同一世界的真实声明恢复后可正常读取；下一次在稳定的新内容上读到新的完整事实，
不能只恒拒绝或缓存旧来源。声明在世界中的内容变更不修改 Adapter/Canvas provider 身份。

实际测试只在本卡创建的临时世界副本制造缺项或内容漂移，不修改生产包/源码正常声明，
不替换 sourceDeclaration、facts.lua、readCanvasFacts 或原生响应。原生结果序列化后，
观测器可作为外部编辑者改变世界中的真实文件，在响应接收释放下一次读之前完成；
这不是修改响应字节，也不是同步 guard 承诺。源码与同一默认严格安装 tgz 的真实 Luanti
均有正常、缺项、漂移、恢复及正负非零坐标/轴序往返测试；这些断言红阶段不宣称已经成功。

## 正常声明的坐标及用途依据

正常载荷的工具清单及典型尺寸是本 world-source 明示的工具用法说明，覆盖其声明的 fill/line/replace；不是游戏名识别、身体包络、预算推值或写入上限。单位 world-cell 与 engine.lua 的三整数格点及 world-vocabulary.mjs Record 转换对应，metersPerGridUnit:null 是明确未声明物理换算。

Frame 的 record-position/v1 变换在 engine.lua 原生 {x,y,z} 与中立 [x,y,z] 之间保持轴序和原点，world-vocabulary.mjs 保留该坐标。手性参考 Luanti 官方 Coordinate System（物理右/上/前）及 Nodes 旋转约定：https://api.luanti.org/coordinate-system/ 、https://api.luanti.org/nodes/ 。源码和同一正常严格 tgz 的真实测试独立观测 yaw/facedir/wallmounted，以右/上/后参考的四面体有向体积比校准公开 Frame，单独翻转声明手性须检出并恢复；不以声明或旧 ReadEngineFacts.frame 作预期。校准断言不是新增生产错误码。

声明在初始化时纳入载荷摘要及配对，运行中每次 fact_world_source 读取世界副本实际字节、按 worldRef/字段生成不透明来源引用。内容修订为原始字节 SHA256；partition 来自实际 MAP_BLOCKSIZE，其修订由该原生观测形成。Host 实例生成 provider 身份，只使用现有公开读取路径校验，不扩充握手或同步 guard。
