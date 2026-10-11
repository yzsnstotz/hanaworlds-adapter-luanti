# Luanti source locator · `hanaworlds-luanti-source-locator/v1`

`hanaworldsLuantiLocalWorlds.describeSourceWorld({contractVersion: 'local-worlds/v2', requestId, worldRef})`
(contracts `v2.5.0`, `LocalWorldsDescribeSourceRequest/Response`) is a read-only description
of where one exact world of this Luanti world source is **now**. The contract keeps
`sourceLocator` opaque; this page is the only definition of its shape and is meant for the
paired local-runtime of the same world source. No other plugin may interpret it, extract
paths or settings from it, or carry it into `C-world-lifecycle` (including `creationFacts`).

## How the Adapter answers

1. Discovers the configured world roots (`localWorldRoots`) exactly as `discover` does and
   selects by `worldRef` only. A world with this Adapter's payload is selected by the payload
   `worldRef`; a world without it by its discovery reference `local:<sha256(worldPath)>`.
   Display names are never keys: two worlds may share a name.
2. Requires exactly one match inside a configured root, a real (not symlinked) directory whose
   `realpath` equals the discovered path, and a canonical configured `localUserPath` if one is set.
3. Observes the world twice (discovery + directory `lstat`) and requires the same connection,
   path, `worldRef`, game, payload identity and directory device/inode both times.

It never provisions, pairs, starts or stops a game, writes files or metadata, opens a lease,
or touches Canvas sessions or bindings.

| Refusal | When |
| --- | --- |
| `WORLD_NOT_FOUND` | No discovered world has this `worldRef` (never existed, deleted, replaced by another world, directory gone). |
| `CURRENT_WORLD_MISMATCH` | The reference is held by more than one directory, the path is not canonical, or identity changed during the read. |
| `ADAPTER_UNAVAILABLE` | A configured root or user path is unreadable/not canonical, or the service is closed. |

Refusals are `phase: validate`, `reason: REQUIRED_FACT_UNKNOWN`, `mutationState: NONE`, and are
logged as `LOCAL_SOURCE_DESCRIBE_REJECTED <reason>`.

## Shape (`src/source-locator.d.ts`, `LuantiSourceLocator`)

```json
{
  "locatorVersion": "hanaworlds-luanti-source-locator/v1",
  "worldRef": "luanti:…",
  "connectionRef": "local:<sha256 of worldPath>",
  "worldPath": "/canonical/root/World name",
  "worldRoot": "/canonical/root",
  "userPath": "/canonical/luanti-user" ,
  "directory": { "device": "16777234", "inode": "338864309" },
  "gameId": "mineclone2",
  "payload": { "status": "INSTALLED_UNVERIFIED", "payloadVersion": "0.10.3", "payloadDigest": "<64 hex>" }
}
```

- `userPath` is `null` when this world source has no `localUserPath` configured; the runtime
  must then report that it needs one rather than inventing a path.
- `directory` values are decimal strings so 64-bit inode numbers survive JSON.
- `payload.status` is `MISSING` (with `payloadVersion`/`payloadDigest` null) for an existing world
  this Adapter has not provisioned yet; `INSTALLED_UNVERIFIED` means the payload manifest was read
  from disk, not that a running engine loaded it (that is `pair`'s readback).

## How local-runtime uses it

The locator is a read-time observation, not authority and not durable identity. Before acting on
it the runtime rechecks: `worldPath` still canonical, inside `worldRoot`, same `directory`
device/inode, same payload identity. Any difference means the world moved or was replaced:
ask the Adapter again with the same `worldRef` (and expect `WORLD_NOT_FOUND` if it is gone).

Fixture/mock: `fixtures/local-world-source.json` (package export
`hanaworlds-adapter-luanti/fixtures/local-world-source.json`) holds two same-name worlds with
Luanti-shaped locators and each declared refusal; `createLocalWorldsMock().describeSourceWorld`
(`./local-worlds-v2-mock`) serves it through the SDK's `createLocalWorldSourceMock`. Evidence:
SOURCE/FIXTURE only.
