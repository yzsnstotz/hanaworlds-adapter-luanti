# hanaworlds-adapter-luanti · 插件级验收

真实运行时：**本地 Luanti 进程 + 临时世界**（CI 需能启动 Luanti；没有 Luanti 的 job 只跑 FIXTURE 层）。
Adapter 只做传输与引擎事实；所有写入都由 Canvas 发起。证据上限：`REAL_RUNTIME`。

| ID | 验收条目 | 可见结果 | 怎么跑 | 证据上限 |
| --- | --- | --- | --- | --- |
| AD-01 | 发现本地 Luanti 世界并列出名称 | 对一个临时 Luanti 用户目录（含 2 个世界）调用 discovery，返回 2 个世界名与稳定世界身份，不含路径以外的隐私 | FIXTURE：`npm test`（local-worlds）；REAL_RUNTIME：`node test/real-luanti.mjs` 对本地 Luanti | REAL_RUNTIME |
| AD-02 | 绑定后读回一个区域的方块 | 绑定临时世界，`InspectRegion` 返回该区域真实方块事实、完整 Frame 与 Adapter 计算的 `frameDigest`；玩家位置不出引擎 | REAL_RUNTIME：`node test/real-region.mjs` | REAL_RUNTIME |
| AD-03 | 未授权世界写入返回类型化拒绝且零写 | 未授权/撤销授权的 Prepare 返回 `AUTHORIZATION_REVOKED` 或 `PERMISSION_DENIED`，世界字节与写前相同 | `npm test`（v3/v4 negative、INV-PROTECTED-AT-PREPARE）；REAL_RUNTIME：`node test/real-lifecycle.mjs` | REAL_RUNTIME |
| AD-04 | 版本不匹配的 payload 在握手处失败 | 引擎侧 payload 与 Node 侧 major 不同时，握手返回 `UNSUPPORTED_VERSION`，不进入任何操作 | `npm test`（handshake 用例）+ `npm run test:lua` | FIXTURE |
| AD-05 | Lua payload 自身测试通过 | `payload/hanaworlds_adapter/*.lua` 语法检查与 4 个 Lua 套件全部通过 | `npm run build && npm run test:lua`（需要 `lua`/`luac`） | FIXTURE |
