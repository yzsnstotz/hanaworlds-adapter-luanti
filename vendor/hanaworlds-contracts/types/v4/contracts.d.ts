// GENERATED — all 283 approved named types, no any/open object fallback.
export type Ref = string;
export type Revision = string;
export type Digest = string;
export type Text = string;
export type SafeInt = number;
export type NonNegativeInt = number;
export type PositiveInt = number;
export type Finite = number;
export type NonNegativeFinite = number;
export type PositiveFinite = number;
export type Bool = boolean;
/** Order: x,y,z */
export type Position = readonly [SafeInt, SafeInt, SafeInt];
/** min[i]<=max[i]; inclusive; BigInt/exact integer extent arithmetic | no universal volume cap */
export type Box = {
  readonly "min": Position;
  readonly "max": Position;
};
/** nodeName exact registered catalogue name; no alias/default/random/content_id | param2 member of node capability allowedParam2; no direction default */
export type NodeSpec = {
  readonly "nodeName": Ref;
  readonly "param2": Byte;
};
export type Byte = number;
export type Axis = "+X" | "+Y" | "+Z" | "-X" | "-Y" | "-Z";
/** signed permutation; each destination axis exactly once | Order: source X,Y,Z */
export type Axes = readonly [Axis, Axis, Axis];
export type GridUnit = {
  readonly "name": Ref;
  readonly "metersPerGridUnit": PositiveFinite | null;
};
export type Frame = {
  readonly "profileVersion": "frame/v2";
  readonly "frameId": Ref;
  readonly "origin": Position;
  readonly "axes": Axes;
  readonly "handedness": Handedness;
  readonly "gridUnit": GridUnit;
  readonly "transformRevision": Revision;
};
export type Handedness = "left" | "right";
/** min<=max; coordinates relative to node center | Order: minX,minY,minZ,maxX,maxY,maxZ */
export type CollisionBox = readonly [Finite, Finite, Finite, Finite, Finite, Finite];
/** Order: numeric lexicographic six coordinates */
export type CollisionBoxes = ReadonlyArray<CollisionBox>;
/** Order: numeric ascending */
export type Param2s = ReadonlyArray<Byte>;
/** Order: UTF16 ascending */
export type FieldNames = ReadonlyArray<Ref>;
export type Liquid = "none" | "source" | "flowing";
/** unknownFields exactly lists null required properties | unknown needed property -> UNSUPPORTED_MUTATION_SEMANTICS; never treat null as false/0 | base mutable subset requires hasCallbacks=false and hasPersistentState=false; referenced definitionRevision verified by provider */
export type NodeCapability = {
  readonly "walkable": Bool | null;
  readonly "collisionBoxes": CollisionBoxes | null;
  readonly "liquidType": Liquid | null;
  readonly "damagePerSecond": NonNegativeFinite | null;
  readonly "lightSource": Byte | null;
  readonly "param2Type": Ref | null;
  readonly "allowedParam2": Param2s | null;
  readonly "hasCallbacks": Bool | null;
  readonly "hasPersistentState": Bool | null;
  readonly "definitionRevision": Revision | null;
  readonly "unknownFields": FieldNames;
};
export type ModRevisions = { readonly [key: string]: Revision };
export type NodeMap = { readonly [key: string]: NodeCapability };
export type Catalogue = {
  readonly "profileVersion": "catalogue/v2";
  readonly "engineProfile": Ref;
  readonly "gameId": Ref;
  readonly "gameRevision": Revision;
  readonly "modRevisions": ModRevisions;
  readonly "nodes": NodeMap;
};
/** actual provider movement profile; no default avatar size */
export type AvatarDimensions = {
  readonly "width": PositiveFinite;
  readonly "height": PositiveFinite;
  readonly "depth": PositiveFinite;
  readonly "unit": Ref;
};
/** explicit attributed policy, not invented threshold */
export type HazardPolicy = {
  readonly "forbidLiquid": Bool;
  readonly "maximumDamagePerSecond": NonNegativeFinite;
};
export type LightRule = {
  readonly "minimumLight": Byte;
  readonly "sourceRevision": Revision;
};
/** requireProtectedClearance=true and requireBodyClearance=true for mutation | entrance requirement selected confirmed use; missing provider policy/profile -> CAPABILITY_UNAVAILABLE, no default safe */
export type SafetyProfile = {
  readonly "profileVersion": "safety-profile/v2";
  readonly "avatarDimensions": AvatarDimensions;
  readonly "connectivity": 6;
  readonly "requireProtectedClearance": Bool;
  readonly "requireBodyClearance": Bool;
  readonly "requireEntranceConnectivity": Bool;
  readonly "hazardPolicy": HazardPolicy;
  readonly "optionalLightRule": LightRule | null;
};
export type CompilationConfig = {
  readonly "profileVersion": "compilation-config/v2";
  readonly "backendProfileId": Ref;
  readonly "worldeditRevision": Revision;
  readonly "nodeWriteSemantics": "explicit-nodeName-param2-static-v2";
  readonly "overlapRule": "last-writer-wins";
  readonly "effectOrder": "numeric-x-y-z";
  readonly "compressionRule": "exact-final-effects-only";
};
export type Effect = {
  readonly "position": Position;
  readonly "nodeName": Ref;
  readonly "param2": Byte;
};
/** Order: position numeric x,y,z */
export type Effects = ReadonlyArray<Effect>;
/** Order: numeric x,y,z */
export type Positions = ReadonlyArray<Position>;
/** Order: UTF16 ascending */
export type RefSet = ReadonlyArray<Ref>;
/** Order: input */
export type OrderedRefs = ReadonlyArray<Ref>;
export type FinalEffects = {
  readonly "profileVersion": "final-effects/v2";
  readonly "frameDigest": Digest;
  readonly "catalogueDigest": Digest;
  readonly "effects": Effects;
};
/** every position within sampledBounds; required domain coverage has no omissions | compressed transport expands exactly before hash */
export type Coverage = {
  readonly "profileVersion": "coverage/v2";
  readonly "sampledBounds": Box;
  readonly "sampledPositions": Positions;
};
/** nodeName != air; nonwalkable remains occupied */
export type OccupiedCell = {
  readonly "position": Position;
  readonly "nodeName": Ref;
  readonly "param2": Byte;
};
/** Order: position numeric x,y,z */
export type OccupiedCells = ReadonlyArray<OccupiedCell>;
export type UnknownReason = "UNLOADED" | "IGNORE" | "READ_FAILED";
export type UnknownCell = {
  readonly "position": Position;
  readonly "reason": UnknownReason;
};
/** Order: position numeric x,y,z */
export type UnknownCells = ReadonlyArray<UnknownCell>;
/** nonempty exact portal plane; six-neighbor cavity closes verified entrance plane only */
export type Portal = {
  readonly "portalRef": Ref;
  readonly "positions": Positions;
};
/** Order: portalRef UTF16 ascending */
export type Portals = ReadonlyArray<Portal>;
/** physical volume/standing area null when physical conversion unknown; never replace counts with volume | unknown in required cavity coverage -> entire usableVolume=null */
export type UsableVolume = {
  readonly "emptyCellCount": NonNegativeInt;
  readonly "physicalVolume": NonNegativeFinite | null;
  readonly "standingArea": NonNegativeFinite | null;
  readonly "unit": Ref;
};
export type FactsSource = "INSPECTED" | "PLANNED" | "REGION_INSPECTED";
/** INSPECTED: worldRef/objectRef/worldRevision/objectRevision nonnull; buildDigest/planRevision null | PLANNED: worldRef/objectRef/worldRevision/objectRevision null; buildDigest/planRevision nonnull and preceding plan only | three cell sets disjoint and union exactly coverage.sampledPositions; missing is UNKNOWN, never air | landed Interior changes require INSPECTED; source cannot be relabelled under same digest | all digest dependencies acyclic | REGION_INSPECTED (profileVersion target-facts/v3 only): worldRef/worldRevision nonnull; objectRef/objectRevision/buildDigest/planRevision null; produced only by world-adapter/v4 InspectRegion and relayed unchanged by canvas/v4 InspectPlacementRegion; consumed only by picture-blocks for a first new building; never relabelled INSPECTED/PLANNED under the same digest; a contracts@0.2.1 decoder rejects it at decode | rc.7 value-set version: profileVersion target-facts/v3 iff source=REGION_INSPECTED; INSPECTED and PLANNED keep target-facts/v2, so existing target-facts digests and the nineteen production goldens are unchanged; fact profiles are exchanged in ContractHandshake.factProfiles and a peer lacking target-facts/v3 fails the handshake with UNSUPPORTED_VERSION */
export type TargetFacts = {
  readonly "profileVersion": "target-facts/v2" | "target-facts/v3";
  readonly "source": FactsSource;
  readonly "worldRef": Ref | null;
  readonly "objectRef": Ref | null;
  readonly "worldRevision": Revision | null;
  readonly "objectRevision": Revision | null;
  readonly "buildDigest": Digest | null;
  readonly "planRevision": Revision | null;
  readonly "catalogueDigest": Digest;
  readonly "frameDigest": Digest;
  readonly "sampledBounds": Box;
  readonly "coverageDigest": Digest;
  readonly "occupiedCells": OccupiedCells;
  readonly "knownEmptyCells": Positions;
  readonly "unknownCells": UnknownCells;
  readonly "portals": Portals;
  readonly "usableVolume": UsableVolume | null;
};
export type MaterialMap = { readonly [key: string]: NodeSpec };
/** inclusive min<=max; materialRef exact map key */
export type SetBox = {
  readonly "op": "set_box";
  readonly "min": Position;
  readonly "max": Position;
  readonly "materialRef": Ref;
};
/** Order: input; last writer wins */
export type BuildOps = ReadonlyArray<SetBox>;
/** trusted provider verified source; caller JSON does not establish evidence authenticity | world bindings nonnull for actual protection/body evidence */
export type EvidenceBinding = {
  readonly "providerRef": Ref;
  readonly "sourceRevision": Revision;
  readonly "worldRef": Ref | null;
  readonly "worldRevision": Revision | null;
};
export type CoverageWitness = {
  readonly "evidence": EvidenceBinding;
  readonly "positions": Positions;
};
/** must include all effects; protectedPositions empty for mutation; actual engine per-cell check always revalidated */
export type ProtectionWitness = {
  readonly "evidence": EvidenceBinding;
  readonly "positions": Positions;
  readonly "protectedPositions": Positions;
};
/** actual authenticated engine occupancy/movement evidence; effects/body sets disjoint */
export type BodyWitness = {
  readonly "evidence": EvidenceBinding;
  readonly "positions": Positions;
  readonly "bodyOccupiedPositions": Positions;
  readonly "avatarDimensions": AvatarDimensions;
};
/** ordered six-neighbor path over inspected/planned verified empty passable cells; real collision clearance at actual dimensions */
export type EntranceWitness = {
  readonly "evidence": EvidenceBinding;
  readonly "portalRef": Ref;
  readonly "usablePositions": Positions;
  readonly "path": PositionPath;
  readonly "avatarDimensions": AvatarDimensions;
};
/** Order: path traversal */
export type PositionPath = ReadonlyArray<Position>;
/** recompute from catalogue at every path/use cell; threshold equals bound safety profile */
export type HazardWitness = {
  readonly "evidence": EvidenceBinding;
  readonly "positions": Positions;
  readonly "forbidLiquid": Bool;
  readonly "maximumDamagePerSecond": NonNegativeFinite;
};
export type Witness = {
  readonly "witnessId": Ref;
  readonly "predicate": "COVERAGE";
  readonly "finalEffectsDigest": Digest;
  readonly "targetFactsDigest": Digest;
  readonly "safetyProfileDigest": Digest;
  readonly "facts": CoverageWitness;
} | {
  readonly "witnessId": Ref;
  readonly "predicate": "PROTECTION";
  readonly "finalEffectsDigest": Digest;
  readonly "targetFactsDigest": Digest;
  readonly "safetyProfileDigest": Digest;
  readonly "facts": ProtectionWitness;
} | {
  readonly "witnessId": Ref;
  readonly "predicate": "BODY_CLEARANCE";
  readonly "finalEffectsDigest": Digest;
  readonly "targetFactsDigest": Digest;
  readonly "safetyProfileDigest": Digest;
  readonly "facts": BodyWitness;
} | {
  readonly "witnessId": Ref;
  readonly "predicate": "ENTRANCE_CONNECTIVITY";
  readonly "finalEffectsDigest": Digest;
  readonly "targetFactsDigest": Digest;
  readonly "safetyProfileDigest": Digest;
  readonly "facts": EntranceWitness;
} | {
  readonly "witnessId": Ref;
  readonly "predicate": "HAZARD";
  readonly "finalEffectsDigest": Digest;
  readonly "targetFactsDigest": Digest;
  readonly "safetyProfileDigest": Digest;
  readonly "facts": HazardWitness;
};
export type WitnessPredicate = "COVERAGE" | "PROTECTION" | "BODY_CLEARANCE" | "ENTRANCE_CONNECTIVITY" | "HAZARD";
/** at least one evidence for each predicate required by safety profile; no bare safe:true | geometry predicates recomputed from final-effects/target-facts/catalogue; protection/body evidence verified from trusted Adapter output | Order: witnessId UTF16 ascending */
export type Witnesses = ReadonlyArray<Witness>;
/** declaredBounds exact union bounds of ordered writes; no implicit target state | witness finalEffectsDigest excludes buildDigest to avoid cycle */
export type BuildProjection = {
  readonly "contractVersion": "BUILD/V2";
  readonly "documentId": Ref;
  readonly "coordinateFrame": Frame;
  readonly "catalogueDigest": Digest;
  readonly "targetFactsDigest": Digest;
  readonly "safetyProfileDigest": Digest;
  readonly "materials": MaterialMap;
  readonly "operations": BuildOps;
  readonly "declaredBounds": Box;
  readonly "witnesses": Witnesses;
};
export type OperationsProjection = {
  readonly "contractVersion": "operations/v2";
  readonly "buildDigest": Digest;
  readonly "compilerRevision": Revision;
  readonly "compilationConfigDigest": Digest;
  readonly "worldRef": Ref;
  readonly "frameDigest": Digest;
  readonly "catalogueDigest": Digest;
  readonly "targetFactsDigest": Digest;
  readonly "effects": Effects;
};
export type MediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
/** projectionVariantId and projectionBytesDigest both null or both nonnull | bytes,width,height describe stored bytes; transformed actual model bytes must be bound by projectionBytesDigest; variantId is never bytes digest */
export type MediaBinding = {
  readonly "attachmentRef": Ref;
  readonly "storedBytesDigest": Digest;
  readonly "projectionVariantId": Ref | null;
  readonly "projectionBytesDigest": Digest | null;
  readonly "mediaType": MediaType;
  readonly "bytes": PositiveInt;
  readonly "width": PositiveInt;
  readonly "height": PositiveInt;
};
/** Order: user input */
export type Media = ReadonlyArray<MediaBinding>;
/** no invented purpose/scale; missing needed values -> clarification; controls changes new brief */
export type Controls = {
  readonly "purpose": Text | null;
  readonly "dimensions": AvatarDimensions | null;
  readonly "entrancePortalRefs": OrderedRefs;
  readonly "styleText": Text | null;
};
export type BriefProjection = {
  readonly "contractVersion": "ReferenceBrief/v2";
  readonly "sessionRef": Ref;
  readonly "turnRevision": Revision;
  readonly "briefRevision": Revision;
  readonly "media": Media;
  readonly "text": Text;
  readonly "controls": Controls;
};
export type ConfirmedIntent = {
  readonly "kind": IntentKind;
  readonly "text": Text;
  readonly "purpose": Text | null;
  readonly "dimensions": AvatarDimensions | null;
  readonly "entrancePortalRefs": OrderedRefs;
  readonly "confirmedTurnRevision": Revision;
};
export type IntentKind = "BUILD_STRUCTURE" | "MODIFY_INTERIOR" | "MODIFY_OBJECT" | "UNDO" | "REDO";
export type IntentProjection = {
  readonly "contractVersion": "session/v2";
  readonly "referenceBriefDigest": Digest;
  readonly "confirmedIntent": ConfirmedIntent;
  readonly "intendedWorldRef": Ref;
  readonly "orderedTargetRefs": OrderedRefs;
};
export type AffectedProjection = {
  readonly "contractVersion": "canvas/v2";
  readonly "worldRef": Ref;
  readonly "worldRevision": Revision;
  readonly "registryRevision": Revision;
  readonly "selectionRevision": Revision;
  readonly "operationDigest": Digest;
  readonly "orderedSelectedRefs": OrderedRefs;
  readonly "affectedObjectRefs": RefSet;
};
export type ActionProjection = {
  readonly "contractVersion": "interaction-surface/v2";
  readonly "sessionRef": Ref;
  readonly "turnRevision": Revision;
  readonly "frameRef": Ref;
  readonly "frameRevision": Revision;
  readonly "actionId": Ref;
  readonly "orderedTargetRefs": OrderedRefs;
  readonly "intentDigest": Digest;
  readonly "operationDigest": Digest | null;
  readonly "analysisDigest": Digest | null;
  readonly "decisionRevision": Revision | null;
};
export type AllowedAction = "READ" | "SELECT" | "NAME" | "RENAME" | "INSPECT" | "ANALYZE" | "DECIDE" | "APPLY_RECOVERABLE" | "READBACK" | "UNDO" | "REDO" | "HISTORY";
/** Order: UTF16 ascending */
export type Actions = ReadonlyArray<AllowedAction>;
/** verifier result from authenticated engine callback/operator + trusted transport; ordinary JSON not issuer | revoke/privilege/protection rechecked; no real binding => zero write */
export type VerifiedBinding = {
  readonly "authorizerRef": Ref;
  readonly "actorRef": Ref;
  readonly "bindingRef": Ref;
  readonly "worldRef": Ref;
  readonly "grantEpoch": Revision;
  readonly "allowedActions": Actions;
};
export type AuthProjection = {
  readonly "contractVersion": "world-adapter/v2";
  readonly "authorizerRef": Ref;
  readonly "actorRef": Ref;
  readonly "grantEpoch": Revision;
  readonly "bindingRef": Ref;
  readonly "worldRef": Ref;
  readonly "sessionRef": Ref;
  readonly "turnRevision": Revision;
  readonly "intentDigest": Digest;
  readonly "surfaceActionDigest": Digest;
  readonly "allowedAction": AllowedAction;
  readonly "transactionId": Ref;
  readonly "operationDigest": Digest;
  readonly "worldRevision": Revision;
  readonly "selectionRevision": Revision;
  readonly "analysisDigest": Digest | null;
  readonly "decisionRevision": Revision | null;
};
export type ObjectRevisions = { readonly [key: string]: Revision };
export type TxProjection = {
  readonly "contractVersion": "canvas/v2";
  readonly "transactionId": Ref;
  readonly "operationDigest": Digest;
  readonly "authorizationBindingDigest": Digest;
  readonly "expectedWorldRevision": Revision;
  readonly "expectedObjectRevisions": ObjectRevisions;
  readonly "beforeImageDigest": Digest;
};
export type Phase = "decode" | "authorize" | "replay" | "validate" | "apply" | "readback" | "restore" | "persist";
export type Retryability = "NEVER" | "AFTER_NEW_AUTH" | "AFTER_NEW_FACTS" | "SAME_TRANSACTION_QUERY" | "AFTER_MANUAL_RECOVERY";
export type MutationState = "NONE" | "VERIFIED" | "ROLLED_BACK" | "PARTIAL" | "UNKNOWN";
export type ErrorCode = "SCHEMA_INVALID" | "NON_CANONICAL_AMBIGUITY" | "UNSUPPORTED_VERSION" | "UNKNOWN_REQUIRED_FIELD" | "CAPABILITY_UNAVAILABLE" | "INVALID_FRAME" | "UNKNOWN_ACTION" | "STALE_REVISION" | "ACTION_NOT_AUTHORIZED" | "RENDERER_CAPABILITY_UNAVAILABLE" | "ADAPTER_UNAVAILABLE" | "CONNECTION_NOT_FOUND" | "CONNECTION_UNAUTHORIZED" | "WORLD_NOT_FOUND" | "PAYLOAD_VERSION_MISMATCH" | "PERMISSION_DENIED" | "AUTHORIZATION_REVOKED" | "REPLAY_MISMATCH" | "WORLD_NOT_BOUND" | "OBJECT_NOT_FOUND" | "OBJECT_SCOPE_MISMATCH" | "INVALID_NAME" | "OBJECT_NAME_CONFLICT" | "INVALID_SELECTION" | "DUPLICATE_OBJECT_REF" | "INSPECTION_FAILED" | "OTHER_OBJECTS_AFFECTED" | "TRANSACTION_CONFLICT" | "STALE_TRANSACTION" | "APPLY_FAILED" | "READBACK_FAILED" | "READBACK_MISMATCH" | "RESTORE_FAILED" | "ROLLBACK_FAILED" | "RECOVERY_PENDING" | "UNDO_CONFLICT" | "REDO_CONFLICT" | "REDO_UNAVAILABLE" | "SESSION_NOT_FOUND" | "AMBIGUOUS_INTENT" | "CROSS_WORLD_REFERENCE_AMBIGUOUS" | "MODEL_UNAVAILABLE" | "MODEL_REQUEST_FAILED" | "ATTACHMENT_REJECTED" | "SESSION_DELETE_UNSUPPORTED" | "SAVED_RESOURCE_UNAVAILABLE" | "RESOURCE_EXPIRED" | "INTENT_UNCONFIRMED" | "IMAGE_REQUIRED" | "TARGET_REQUIRED" | "TARGET_FACTS_STALE" | "TARGET_FACTS_INCOMPLETE" | "AMBIGUOUS_GEOMETRY" | "UNSUPPORTED_MATERIAL" | "BUILD_INVALID" | "MEDIA_BINDING_INVALID" | "MEDIA_DIGEST_MISMATCH" | "TURN_REVISION_MISMATCH" | "UNSUPPORTED_MEDIA_TYPE" | "MEDIA_TOO_LARGE" | "UNSUPPORTED_OPERATION" | "CATALOGUE_MISMATCH" | "SAFETY_INVARIANT_FAILED" | "UNSUPPORTED_MUTATION_SEMANTICS" | "LIMIT_EXCEEDED";
export type ErrorReason = "INVALID_UTF8" | "DUPLICATE_DECODED_KEY" | "LONE_SURROGATE" | "INVALID_NUMBER" | "INVALID_SHAPE" | "UNKNOWN_FIELD" | "VERSION_UNSUPPORTED" | "IDENTITY_UNVERIFIED" | "GRANT_REVOKED" | "SCOPE_DENIED" | "PAYLOAD_CHANGED" | "REVISION_CHANGED" | "INVALID_GEOMETRY" | "CATALOGUE_UNRESOLVED" | "REQUIRED_FACT_UNKNOWN" | "POLICY_UNAVAILABLE" | "LIMIT_EXCEEDED" | "NAME_FORBIDDEN_CHARACTER" | "NAME_INVISIBLE_OR_EMPTY" | "NAME_KEY_EXISTS" | "MEDIA_NOT_REFERENCED" | "MEDIA_CORRUPT" | "DELETE_SEAM_ABSENT" | "RESOURCE_MISSING" | "UNSUPPORTED_STATE_COVERAGE" | "APPLY_ERROR" | "READBACK_ERROR" | "RESTORE_ERROR" | "PERSIST_ERROR" | "EXTERNAL_EDIT_CONFLICT" | "TRANSPORT_OUTCOME_UNKNOWN" | "OWNERSHIP_VIOLATION";
export type Error = {
  readonly "code": ErrorCode;
  readonly "phase": Phase;
  readonly "retryability": Retryability;
  readonly "mutationState": MutationState;
  readonly "transactionRef": Ref | null;
  readonly "causeCode": ErrorCode | null;
  readonly "reason": ErrorReason;
};
export type ReceiptStatus = "APPLIED_PENDING_READBACK" | "VERIFIED_PENDING_HISTORY" | "VERIFIED" | "ROLLED_BACK" | "RESTORE_FAILED" | "RECOVERY_PENDING" | "REJECTED";
export type RestoreStatus = "NOT_REQUIRED" | "RESTORING" | "VERIFIED_RESTORED" | "FAILED" | "UNKNOWN";
/** VERIFIED => readbackDigest and observedWorldRevision nonnull, error=null, restoreStatus=NOT_REQUIRED, linked history durable | pending is not product success; restore failed => error phase restore, causeCode original cause, mutationState PARTIAL or UNKNOWN | ROLLED_BACK requires verified restore readback; timeout => RECOVERY_PENDING/UNKNOWN, never NONE */
export type ReceiptProjection = {
  readonly "contractVersion": "canvas/v2";
  readonly "transactionId": Ref;
  readonly "operationDigest": Digest;
  readonly "transactionPayloadDigest": Digest;
  readonly "status": ReceiptStatus;
  readonly "previousWorldRevision": Revision;
  readonly "observedWorldRevision": Revision | null;
  readonly "readbackDigest": Digest | null;
  readonly "restoreStatus": RestoreStatus;
  readonly "error": Error | null;
};
export type ResourcePurpose = "BUILD_PAYLOAD" | "BUILD_MEDIA_REQUIRED" | "HISTORY_BEFORE_IMAGE" | "HISTORY_READBACK";
export type Resource = {
  readonly "resourceId": Ref;
  readonly "ownerRef": Ref;
  readonly "bytesDigest": Digest;
  readonly "mediaType": Ref;
  readonly "bytes": NonNegativeInt;
  readonly "purpose": ResourcePurpose;
};
/** Order: resourceId UTF16 ascending */
export type Resources = ReadonlyArray<Resource>;
/** workId denotes existing Stage1 BUILD/object/history artifact only; no Stage2 work registry | own authorized durable bytes; manifest published after resource durability; no deleted Session requirement | only resources necessary for declared existing BUILD/object/history; no all-chat clone */
export type SavedResources = {
  readonly "profileVersion": "saved-work-resources/v2";
  readonly "workId": Ref;
  readonly "workRevision": Revision;
  readonly "resources": Resources;
};
export type StringMap = { readonly [key: string]: Text };
/** Order: engine slot order including empty strings */
export type InventorySlots = ReadonlyArray<Text>;
export type Inventory = { readonly [key: string]: InventorySlots };
export type Timer = {
  readonly "timeout": NonNegativeFinite;
  readonly "elapsed": NonNegativeFinite;
};
export type Record = {
  readonly "position": Position;
  readonly "nodeName": Ref;
  readonly "param1": Byte;
  readonly "param2": Byte;
  readonly "metadata": StringMap;
  readonly "inventory": Inventory;
  readonly "timer": Timer | null;
};
/** Order: position numeric x,y,z */
export type Records = ReadonlyArray<Record>;
/** Order: fixed explicit complete node fields */
export type NodeFields = readonly ["nodeName", "param1", "param2"];
/** actual export and timer/light behavior proven per backend; unsupported side effects rejected before write | all node fields/metadata/inventory/timer exact; derived light recomputed+readback by profile, no silent omission */
export type StateProfile = {
  readonly "profileVersion": "state-profile/v2";
  readonly "nodeFields": NodeFields;
  readonly "metadataMode": "exact";
  readonly "inventoryMode": "exact";
  readonly "timerMode": "exact";
  readonly "derivedLightMode": "recompute-with-readback";
};
/** records positions exactly coveredPositions; include air; private payload never public receipt/chat */
export type BeforeImage = {
  readonly "worldRef": Ref;
  readonly "worldRevision": Revision;
  readonly "coveredPositions": Positions;
  readonly "records": Records;
  readonly "stateProfile": StateProfile;
};
/** records positions exactly coveredPositions; no wall clock; full affected restore/write state */
export type ReadbackProjection = {
  readonly "worldRef": Ref;
  readonly "coveredPositions": Positions;
  readonly "records": Records;
  readonly "stateProfile": StateProfile;
};
export type Limit = {
  readonly "limitKind": LimitKind;
  readonly "actual": NonNegativeInt;
  readonly "limit": NonNegativeInt;
  readonly "source": Ref;
  readonly "sourceRevision": Revision;
};
export type LimitKind = "BYTES" | "PIXELS" | "WIDTH" | "HEIGHT" | "BATCH_COUNT" | "COORDINATE" | "ENGINE_WRITE_CELLS" | "HOST_MEMORY_BYTES" | "REQUEST_BYTES";
/** actual provider-supplied supported facts; null is unavailable, not safe default | limits attributed; absent universal numerical budget does not mean unlimited host capability | profile missing for mutation -> CAPABILITY_UNAVAILABLE before write */
export type PublicCapabilities = {
  readonly "providerRef": Ref;
  readonly "capabilityRevision": Revision;
  readonly "worldRef": Ref | null;
  readonly "engineBounds": Box | null;
  readonly "limits": Limits;
  readonly "recoveryGuarantee": Guarantee | null;
  readonly "stateProfile": StateProfile | null;
  readonly "regionProtectionWriters": RefSet;
  readonly "sessionDeleteSupported": Bool;
  readonly "imageMediaTypes": MediaTypes;
  readonly "model": Ref | null;
};
export type Guarantee = "RECOVERABLE_VERIFIED";
/** Order: limitKind,source UTF16 */
export type Limits = ReadonlyArray<Limit>;
/** Order: UTF16 ascending */
export type MediaTypes = ReadonlyArray<MediaType>;
/** display-only strings; no effects/auth/state/error override; excluded only where explicitly declared */
export type Metadata = { readonly [key: string]: Text };
export type CurrentContext = {
  readonly "currentSession": Ref;
  readonly "activeWorldRef": Ref | null;
  readonly "orderedSelectedObjectRefs": OrderedRefs;
  readonly "sessionRevision": Revision;
  readonly "selectionRevision": Revision;
};
export type Readiness = "READY" | "ADAPTER_UNAVAILABLE" | "CONNECTION_UNAUTHORIZED" | "PAYLOAD_VERSION_MISMATCH" | "CAPABILITY_UNAVAILABLE";
export type ConnectionDescriptor = {
  readonly "adapterId": Ref;
  readonly "connectionRef": Ref;
  readonly "worldRef": Ref;
  readonly "displayName": Text;
  readonly "capabilityRevision": Revision;
  readonly "payloadVersion": Ref;
  readonly "readiness": Readiness;
};
/** Order: adapterId,connectionRef,worldRef UTF16 */
export type Connections = ReadonlyArray<ConnectionDescriptor>;
export type ObjectRecord = {
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "objectRevision": Revision;
  readonly "displayName": Text | null;
  readonly "nameRevision": Revision | null;
  readonly "creationSequence": NonNegativeInt;
  readonly "status": Readiness;
};
/** Order: creationSequence numeric then objectRef UTF16 */
export type Objects = ReadonlyArray<ObjectRecord>;
export type ConnectionInventory = {
  readonly "capabilityRevision": Revision;
  readonly "connections": Connections;
};
export type ObjectInventory = {
  readonly "worldRef": Ref;
  readonly "registryRevision": Revision;
  readonly "objects": Objects;
};
export type ObjectSelection = {
  readonly "sessionRef": Ref;
  readonly "worldRef": Ref;
  readonly "selectedObjectRefs": OrderedRefs;
  readonly "selectionRevision": Revision;
};
export type ObjectNameReceipt = {
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "displayName": Text;
  readonly "comparisonKey": Text;
  readonly "nameRevision": Revision;
  readonly "objectRevision": Revision;
  readonly "registryRevision": Revision;
};
export type DecisionKind = "NO_NOTIFICATION" | "BLOCK_AND_NOTIFY" | "CONTINUE" | "CANCEL";
/** CONTINUE exact displayed affected set; CANCEL zero write; no implicit preview */
export type AffectedDecision = {
  readonly "transactionId": Ref;
  readonly "analysisDigest": Digest;
  readonly "decisionRevision": Revision;
  readonly "decisionKind": DecisionKind;
  readonly "affectedObjectRefs": RefSet;
  readonly "orderedSelectedRefs": OrderedRefs;
};
export type HistoryEntry = {
  readonly "transactionId": Ref;
  readonly "originTransactionId": Ref | null;
  readonly "affectedObjectRefs": RefSet;
  readonly "operationDigest": Digest;
  readonly "beforeImageDigest": Digest;
  readonly "expectedAfterReadbackDigest": Digest;
  readonly "receiptDigest": Digest;
  readonly "historyRevision": Revision;
  readonly "status": ReceiptStatus;
};
/** Order: committed history order; not name order */
export type HistoryEntries = ReadonlyArray<HistoryEntry>;
export type HistoryView = {
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "historyRevision": Revision;
  readonly "headTransactionId": Ref | null;
  readonly "entries": HistoryEntries;
  readonly "undoAvailable": Bool;
  readonly "redoAvailable": Bool;
};
/** choices preserve player edits until explicit user decision; chosen alternative new confirmed intent/analysis/grant/transaction */
export type ConflictProposal = {
  readonly "sessionRef": Ref;
  readonly "turnRevision": Revision;
  readonly "proposalRef": Ref;
  readonly "direction": HistoryDirection;
  readonly "historyTransactionId": Ref;
  readonly "affectedObjectRefs": RefSet;
  readonly "currentReadbackDigest": Digest;
  readonly "expectedReadbackDigest": Digest;
  readonly "historyRevision": Revision;
  readonly "choices": ConflictChoices;
};
export type HistoryDirection = "UNDO" | "REDO";
export type ConflictChoice = "CANCEL" | "CREATE_REVISED_INTENT";
/** Order: fixed input */
export type ConflictChoices = ReadonlyArray<ConflictChoice>;
export type ClarificationNeed = {
  readonly "sessionRef": Ref;
  readonly "turnRevision": Revision;
  readonly "invocationId": Ref;
  readonly "clarificationId": Ref;
  readonly "code": ErrorCode;
  readonly "question": Text;
};
export type BuildPlan = {
  readonly "invocationId": Ref;
  readonly "build": BuildProjection;
  readonly "buildDigest": Digest;
};
/** before-image stored privately and durable barrier proven before PREPARED; provider owns bytes */
export type PreparedTransaction = {
  readonly "payload": TxProjection;
  readonly "transactionPayloadDigest": Digest;
  readonly "beforeImageDigest": Digest;
  readonly "guarantee": Guarantee;
  readonly "stateProfile": StateProfile;
  readonly "protectedPositions": Positions;
  readonly "adapterExecutionRevision": Revision;
};
export type SessionSnapshot = {
  readonly "context": CurrentContext;
  readonly "turns": TurnRecords;
  readonly "capabilities": PublicCapabilities;
  readonly "sessionDeleteSupported": Bool;
};
export type TurnRecord = {
  readonly "turnRef": Ref;
  readonly "turnRevision": Revision;
  readonly "text": Text;
  readonly "media": Media;
  readonly "referenceBriefDigest": Digest | null;
  readonly "intentDigest": Digest | null;
  readonly "actionReceiptDigest": Digest | null;
};
/** Order: Core durable turn order */
export type TurnRecords = ReadonlyArray<TurnRecord>;
export type TurnReceipt = {
  readonly "sessionRef": Ref;
  readonly "turnRef": Ref;
  readonly "turnRevision": Revision;
  readonly "briefDigest": Digest | null;
  readonly "model": Ref;
  readonly "resultText": Text;
  readonly "clarification": ClarificationNeed | null;
};
/** deleted true only supported public host seam durably removes Session as required; no archive substitution */
export type DeleteSessionReceipt = {
  readonly "sessionRef": Ref;
  readonly "deleted": Bool;
  readonly "remainingArtifactRefs": RefSet;
};
/** durable must be true before saving success; missing required bytes -> SAVED_RESOURCE_UNAVAILABLE */
export type SavedResourceReceipt = {
  readonly "manifest": SavedResources;
  readonly "resourceManifestDigest": Digest;
  readonly "durable": Bool;
};
/** no old Session read dependency */
export type ReopenedArtifact = {
  readonly "manifest": SavedResources;
  readonly "resourceManifestDigest": Digest;
  readonly "artifactRef": Ref;
};
export type ActionInputKind = "TEXT" | "SELECT_OBJECTS" | "NAME" | "DECISION" | "PICK_WORLD_POINT" | "SELECT_CHOICE";
/** PICK_WORLD_POINT pickRef is issued only by the Luanti in-world renderer (Adapter origin) after the invoking player points at a node and confirms; the Adapter keeps the picked node, picker and picker facing privately; a pickRef not issued by the Adapter for the same world and session is PERMISSION_DENIED/authorize/IDENTITY_UNVERIFIED at InspectRegion; Shell renderers cannot produce it and show the action as an in-game instruction | SELECT_CHOICE value must equal one choices[].value of the same frameRef/frameRevision/actionId descriptor; otherwise INVALID_SELECTION/validate/SCOPE_DENIED with zero downstream calls; no free-text fallback */
export type ActionInput = {
  readonly "kind": "TEXT";
  readonly "text": Text;
} | {
  readonly "kind": "SELECT_OBJECTS";
  readonly "orderedObjectRefs": OrderedRefs;
} | {
  readonly "kind": "NAME";
  readonly "name": Text;
} | {
  readonly "kind": "DECISION";
  readonly "decision": DecisionKind;
} | {
  readonly "kind": "PICK_WORLD_POINT";
  readonly "pickRef": Ref;
} | {
  readonly "kind": "SELECT_CHOICE";
  readonly "value": Ref;
};
/** Order: UTF16 ascending */
export type ActionInputKinds = ReadonlyArray<ActionInputKind>;
/** choices nonnull iff inputKinds includes SELECT_CHOICE; renderers show each choice as a tappable option and return the selected value; they never parse frame content for options | placement player choice: choices are exactly the Canvas-released PlacementChoiceRequired.candidatePlayerNames (value=label=engineActorName), names only, rendered only to the principal that Canvas released them to (INSPECT on the bound world, revocation checked) | rendering ownership (rc.9 user decision): Workshop owns choice content and the Shell-side SELECT_CHOICE presentation; the Luanti in-world renderer (luanti-adapter-v4) renders PICK_WORLD_POINT only, does not advertise SELECT_CHOICE, shows such an action as "choose in Shell", and answers an in-world SELECT_CHOICE invocation itself with InvokeActionResponse error RENDERER_CAPABILITY_UNAVAILABLE/validate/SCOPE_DENIED/NONE without relaying it to Workshop */
export type ActionDescriptor = {
  readonly "actionId": Ref;
  readonly "inputKinds": ActionInputKinds;
  readonly "surfaceActionDigest": Digest;
  readonly "capabilityRef": Ref;
  readonly "choices": ActionChoices | null;
};
/** Order: renderer declared order */
export type ActionDescriptors = ReadonlyArray<ActionDescriptor>;
export type InteractionFrame = {
  readonly "sessionRef": Ref;
  readonly "turnRevision": Revision;
  readonly "frameRef": Ref;
  readonly "frameRevision": Revision;
  readonly "content": Text;
  readonly "actions": ActionDescriptors;
};
export type ActionReceipt = {
  readonly "invocationId": Ref;
  readonly "resultRevision": Revision;
  readonly "ownerRef": Ref;
  readonly "domainReceiptDigest": Digest | null;
  readonly "accepted": Bool;
};
export type BriefReceipt = {
  readonly "brief": BriefProjection;
  readonly "briefDigest": Digest;
  readonly "turnRevision": Revision;
};
/** readBounds derived only bound coverage; writeBounds exact effects bounds; not independent semantics excluded by projection */
export type CompiledOperationSet = {
  readonly "projection": OperationsProjection;
  readonly "operationDigest": Digest;
  readonly "readBounds": Box;
  readonly "writeBounds": Box;
};
export type ConnectionWorldPayloadReceipt = {
  readonly "connectionRef": Ref;
  readonly "worldRef": Ref;
  readonly "payloadVersion": Ref;
  readonly "payloadDigest": Digest;
  readonly "binding": VerifiedBinding | null;
  readonly "capabilities": PublicCapabilities;
};
export type AdapterReadback = {
  readonly "projection": ReadbackProjection;
  readonly "readbackDigest": Digest;
  readonly "adapterExecutionRevision": Revision;
};
export type ListWorldConnectionsRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "expectedCapabilityRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type WorldConnectionList = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ConnectionInventory | null;
  readonly "error": Error | null;
};
export type SelectWorldConnectionRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "connectionRef": Ref;
  readonly "expectedRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type WorldConnectionSelectedReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": CurrentContext | null;
  readonly "error": Error | null;
};
export type SwitchWorldConnectionRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "fromWorldRef": Ref;
  readonly "toConnectionRef": Ref;
  readonly "toWorldRef": Ref;
  readonly "expectedRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type WorldConnectionSwitchedReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": CurrentContext | null;
  readonly "error": Error | null;
};
export type ListObjectsRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "expectedRevision": Revision | null;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ObjectList = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ObjectInventory | null;
  readonly "error": Error | null;
};
/** only a trusted Canvas-domain invocation matching a durable pending generated-ref record may register | a direct caller-chosen objectRef has no authority and fails before registry mutation */
export type CreateObjectRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "transactionId": Ref;
  readonly "verifiedReceiptDigest": Digest;
  readonly "expectedRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ObjectCreatedReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ObjectRecord | null;
  readonly "error": Error | null;
};
export type NameObjectRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "name": Text;
  readonly "expectedRevision": Revision;
  readonly "expectedRegistryRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ObjectNamedReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ObjectNameReceipt | null;
  readonly "error": Error | null;
};
export type RenameObjectRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "name": Text;
  readonly "expectedRevision": Revision;
  readonly "expectedRegistryRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ObjectRenamedReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ObjectNameReceipt | null;
  readonly "error": Error | null;
};
export type SetObjectSelectionRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "objectRefs": OrderedRefs;
  readonly "expectedSelectionRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ObjectSelectionSetReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ObjectSelection | null;
  readonly "error": Error | null;
};
export type InspectObjectRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "expectedRevision": Revision;
  readonly "sampledBounds": Box;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ObjectInspection = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": TargetFacts | null;
  readonly "error": Error | null;
};
export type AnalyzeAffectedObjectsRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "operations": OperationsProjection;
  readonly "operationDigest": Digest;
  readonly "expectedRevision": Revision;
  readonly "expectedRegistryRevision": Revision;
  readonly "expectedSelectionRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type AffectedObjectAnalysis = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": AffectedProjection | null;
  readonly "error": Error | null;
};
export type DecideAffectedObjectNotificationRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "analysis": AffectedProjection;
  readonly "analysisDigest": Digest;
  readonly "analysisRevision": Revision;
  readonly "decision": DecisionKind;
  readonly "expectedDecisionRevision": Revision | null;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type AffectedObjectNotificationDecision = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": AffectedDecision | null;
  readonly "error": Error | null;
};
/** caller-supplied preparedTransaction is forbidden; strict unknown-field rejection occurs before Adapter calls | Canvas validates and durably reserves exact transaction/prepare request identity before trusted Adapter Prepare | crash/retry queries and recovers the same transaction; no blind new transaction | regionInspectionBinding required when operations.targetFactsDigest equals a Canvas REGION_INSPECTED record digest; Canvas verifies the record, D(build)=operations.buildDigest, frame/target-facts digests and PROTECTION/BODY_CLEARANCE witness evidence/positions against its own record in the authorize phase; mismatch or missing binding PERMISSION_DENIED/authorize/IDENTITY_UNVERIFIED/NONE before any Adapter call; then stale record STALE_REVISION/validate/REVISION_CHANGED/NONE */
export type ApplyRecoverableCommitRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "operations": OperationsProjection;
  readonly "operationDigest": Digest;
  readonly "authorizationBinding": AuthProjection;
  readonly "authorizationBindingDigest": Digest;
  readonly "analysisDigest": Digest;
  readonly "decisionRevision": Revision | null;
  readonly "expectedWorldRevision": Revision;
  readonly "expectedObjectRevisions": ObjectRevisions;
  readonly "guarantee": Guarantee;
  readonly "regionInspectionBinding": RegionApplyBinding | null;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type RecoverableCommitAppliedReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ReceiptProjection | null;
  readonly "error": Error | null;
};
export type CanvasReadbackRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "commitRevision": Revision;
  readonly "expectedOperations": OperationsProjection;
  readonly "transactionPayloadDigest": Digest;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type CanvasReadbackReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ReceiptProjection | null;
  readonly "error": Error | null;
};
export type UndoRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "transactionId": Ref;
  readonly "historyTransactionId": Ref;
  readonly "expectedHistoryRevision": Revision;
  readonly "expectedWorldRevision": Revision;
  readonly "expectedObjectRevisions": ObjectRevisions;
  readonly "intentDigest": Digest;
  readonly "surfaceActionDigest": Digest;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type UndoReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ReceiptProjection | null;
  readonly "error": Error | null;
};
export type RedoRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "transactionId": Ref;
  readonly "historyTransactionId": Ref;
  readonly "expectedHistoryRevision": Revision;
  readonly "expectedWorldRevision": Revision;
  readonly "expectedObjectRevisions": ObjectRevisions;
  readonly "intentDigest": Digest;
  readonly "surfaceActionDigest": Digest;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type RedoReceipt = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": ReceiptProjection | null;
  readonly "error": Error | null;
};
export type HistoryQuery = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "objectRef": Ref;
  readonly "expectedHistoryRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ObjectHistoryView = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": HistoryView | null;
  readonly "error": Error | null;
};
export type DiscoverConnectionsRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "adapterId": Ref;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type DiscoverConnectionsResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": ConnectionInventory | null;
  readonly "error": Error | null;
};
export type ListWorldsRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "connectionRef": Ref;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ListWorldsResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": ConnectionInventory | null;
  readonly "error": Error | null;
};
export type AuthorizeBindingRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "connectionRef": Ref;
  readonly "expectedCapabilityRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type AuthorizeBindingResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": ConnectionWorldPayloadReceipt | null;
  readonly "error": Error | null;
};
export type InspectWorldRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "expectedWorldRevision": Revision;
  readonly "sampledBounds": Box;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type InspectWorldResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": TargetFacts | null;
  readonly "error": Error | null;
};
export type PrepareRecoverableTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "operationDigest": Digest;
  readonly "operations": OperationsProjection;
  readonly "authorizationBinding": AuthProjection;
  readonly "expectedWorldRevision": Revision;
  readonly "expectedObjectRevisions": ObjectRevisions;
  readonly "guarantee": Guarantee;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type PrepareRecoverableTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": PreparedTransactionResult | null;
  readonly "error": Error | null;
};
export type ApplyCompiledTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "expectedWorldRevision": Revision;
  readonly "preparedTransaction": PreparedTransaction;
  readonly "operations": OperationsProjection;
  readonly "operationDigest": Digest;
  readonly "authorizationBinding": AuthProjection;
  readonly "guarantee": Guarantee;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ApplyCompiledTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": ReceiptProjection | null;
  readonly "error": Error | null;
};
export type ReadbackRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "coveredPositions": Positions;
  readonly "stateProfile": StateProfile;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ReadbackResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": AdapterReadback | null;
  readonly "error": Error | null;
};
export type QueryTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "transactionPayloadDigest": Digest;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type QueryTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": ReceiptProjection | null;
  readonly "error": Error | null;
};
export type RestoreTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "originTransactionId": Ref;
  readonly "operationDigest": Digest;
  readonly "beforeImageDigest": Digest;
  readonly "restoreAttemptIdentity": Ref;
  readonly "guarantee": Guarantee;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type RestoreTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": ReceiptProjection | null;
  readonly "error": Error | null;
};
export type InvokeActionRequest = {
  readonly "contractVersion": "interaction-surface/v3";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "turnRevision": Revision;
  readonly "frameRevision": Revision;
  readonly "frameRef": Ref;
  readonly "actionId": Ref;
  readonly "invocationId": Ref;
  readonly "surfaceAction": ActionProjection;
  readonly "surfaceActionDigest": Digest;
  readonly "input": ActionInput;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type InvokeActionResponse = {
  readonly "contractVersion": "interaction-surface/v3";
  readonly "requestId": Ref;
  readonly "result": ActionReceipt | null;
  readonly "error": Error | null;
};
export type StartOrResumeSessionRequest = {
  readonly "contractVersion": "session/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "expectedRevision": Revision | null;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type StartOrResumeSessionResponse = {
  readonly "contractVersion": "session/v2";
  readonly "requestId": Ref;
  readonly "result": SessionSnapshot | null;
  readonly "error": Error | null;
};
export type AppendMultimodalTurnRequest = {
  readonly "contractVersion": "session/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "turnRef": Ref;
  readonly "expectedRevision": Revision;
  readonly "text": Text;
  readonly "media": Media;
  readonly "controls": Controls;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type AppendMultimodalTurnResponse = {
  readonly "contractVersion": "session/v2";
  readonly "requestId": Ref;
  readonly "result": TurnReceipt | null;
  readonly "error": Error | null;
};
export type AnswerClarificationRequest = {
  readonly "contractVersion": "session/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "turnRef": Ref;
  readonly "expectedRevision": Revision;
  readonly "clarificationId": Ref;
  readonly "answer": Text;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type AnswerClarificationResponse = {
  readonly "contractVersion": "session/v2";
  readonly "requestId": Ref;
  readonly "result": TurnReceipt | null;
  readonly "error": Error | null;
};
export type SwitchWorldContextRequest = {
  readonly "contractVersion": "session/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "expectedRevision": Revision;
  readonly "worldRef": Ref;
  readonly "selectionRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type SwitchWorldContextResponse = {
  readonly "contractVersion": "session/v2";
  readonly "requestId": Ref;
  readonly "result": SessionSnapshot | null;
  readonly "error": Error | null;
};
export type RecordActionReceiptRequest = {
  readonly "contractVersion": "session/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "turnRef": Ref;
  readonly "expectedRevision": Revision;
  readonly "actionId": Ref;
  readonly "domainReceiptDigest": Digest;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type RecordActionReceiptResponse = {
  readonly "contractVersion": "session/v2";
  readonly "requestId": Ref;
  readonly "result": TurnReceipt | null;
  readonly "error": Error | null;
};
export type DeleteSessionRequest = {
  readonly "contractVersion": "session/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "expectedRevision": Revision;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type DeleteSessionResponse = {
  readonly "contractVersion": "session/v2";
  readonly "requestId": Ref;
  readonly "result": DeleteSessionReceipt | null;
  readonly "error": Error | null;
};
export type PersistRequiredArtifactResourcesRequest = {
  readonly "contractVersion": "session/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "artifactRef": Ref;
  readonly "manifest": SavedResources;
  readonly "resourceManifestDigest": Digest;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type PersistRequiredArtifactResourcesResponse = {
  readonly "contractVersion": "session/v2";
  readonly "requestId": Ref;
  readonly "result": SavedResourceReceipt | null;
  readonly "error": Error | null;
};
export type ReopenExistingArtifactRequest = {
  readonly "contractVersion": "session/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "artifactRef": Ref;
  readonly "workRevision": Revision;
  readonly "resourceManifestDigest": Digest;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ReopenExistingArtifactResponse = {
  readonly "contractVersion": "session/v2";
  readonly "requestId": Ref;
  readonly "result": ReopenedArtifact | null;
  readonly "error": Error | null;
};
export type PainterId = "picture-blocks" | "interior";
/** regionInspection nonnull iff targetFacts.source=REGION_INSPECTED; then targetFacts and targetFactsDigest deep-equal regionInspection.targetFacts/targetFactsDigest, painterId=picture-blocks, BUILD.coordinateFrame=regionInspection.frame, PROTECTION/BODY_CLEARANCE witness evidence=regionInspection.evidence, entrance face outward normal=regionInspection.entranceFacing | mismatch TARGET_FACTS_STALE/validate/REVISION_CHANGED; interior with REGION_INSPECTED TARGET_REQUIRED/validate/SCOPE_DENIED; PLANNED without a real preceding plan TARGET_REQUIRED/validate/REQUIRED_FACT_UNKNOWN */
export type CreateBuildPlanRequest = {
  readonly "contractVersion": "painter/v3";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "turnRevision": Revision;
  readonly "painterId": PainterId;
  readonly "invocationId": Ref;
  readonly "intent": IntentProjection;
  readonly "intentDigest": Digest;
  readonly "referenceBrief": BriefProjection;
  readonly "referenceBriefDigest": Digest;
  readonly "catalogue": Catalogue;
  readonly "targetFacts": TargetFacts;
  readonly "targetFactsDigest": Digest;
  readonly "safetyProfile": SafetyProfile;
  readonly "safetyProfileDigest": Digest;
  readonly "regionInspection": RegionInspection | null;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type CreateBuildPlanResponse = {
  readonly "contractVersion": "painter/v3";
  readonly "requestId": Ref;
  readonly "result": BuildPlan | null;
  readonly "error": Error | null;
};
export type BindReferenceBriefRequest = {
  readonly "contractVersion": "ReferenceBrief/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "turnRevision": Revision;
  readonly "brief": BriefProjection;
  readonly "briefDigest": Digest;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type BindReferenceBriefResponse = {
  readonly "contractVersion": "ReferenceBrief/v2";
  readonly "requestId": Ref;
  readonly "result": BriefReceipt | null;
  readonly "error": Error | null;
};
export type ReferenceBriefRequest = {
  readonly "contractVersion": "ReferenceBrief/v2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "brief": BriefProjection;
  readonly "briefDigest": Digest;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type ReferenceBriefResponse = {
  readonly "contractVersion": "ReferenceBrief/v2";
  readonly "requestId": Ref;
  readonly "result": BriefReceipt | null;
  readonly "error": Error | null;
};
export type BuildDocumentRequest = {
  readonly "contractVersion": "BUILD/V2";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "build": BuildProjection;
  readonly "buildDigest": Digest;
  readonly "catalogue": Catalogue;
  readonly "catalogueDigest": Digest;
  readonly "targetFacts": TargetFacts;
  readonly "targetFactsDigest": Digest;
  readonly "safetyProfile": SafetyProfile;
  readonly "safetyProfileDigest": Digest;
  readonly "compilationConfig": CompilationConfig;
  readonly "compilationConfigDigest": Digest;
  readonly "compilerRevision": Revision;
};
/** Emit only after an actual change in the authorized installed Adapter connection inventory/capability revision. receipt.result is the new authorized inventory snapshot. ListWorldConnections by itself does not change state or require this event. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type WorldConnectionInventoryChanged = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "WorldConnectionInventoryChanged";
  readonly "operation": "ListWorldConnections";
  readonly "receipt": WorldConnectionList;
};
/** Emit only after successful durable selection of a changed connection/world; receipt.result is the resulting current context. Failed/no-change selection emits nothing. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type WorldConnectionSelectionChanged = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "WorldConnectionSelectionChanged";
  readonly "operation": "SelectWorldConnection";
  readonly "receipt": WorldConnectionSelectedReceipt;
};
/** Emit only after successful durable switch to a different world; receipt.result is the resulting current context. Preserve currentSession and clear out-of-world selection. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type ActiveWorldChanged = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "ActiveWorldChanged";
  readonly "operation": "SwitchWorldConnection";
  readonly "receipt": WorldConnectionSwitchedReceipt;
};
/** Emit only on an actual durable object registry revision/inventory change; receipt.result is the new authorized object inventory snapshot. A ListObjects read by itself need not emit. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type ObjectInventoryChanged = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "ObjectInventoryChanged";
  readonly "operation": "ListObjects";
  readonly "receipt": ObjectList;
};
/** Emit only after verified creating transaction and durable registration of the stable object; receipt.result is the newly registered object. No event for pending/failed readback. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type ObjectCreated = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "ObjectCreated";
  readonly "operation": "CreateObject";
  readonly "receipt": ObjectCreatedReceipt;
};
/** Emit only after successful atomic name/registry CAS that actually changes the display name/key; operation NameObject or RenameObject selects the exact receipt variant. receipt.result is the new name/registry state; failure/no-change emits nothing. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type ObjectNameChanged = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "ObjectNameChanged";
  readonly "operation": "NameObject";
  readonly "receipt": ObjectNamedReceipt;
} | {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "ObjectNameChanged";
  readonly "operation": "RenameObject";
  readonly "receipt": ObjectRenamedReceipt;
};
/** Emit only after a successful complete ordered selection replacement with a new selectionRevision. receipt.result is the resulting selection, including empty-array clear; failure leaves old selection and emits nothing. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type ActiveObjectSelectionReplaced = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "ActiveObjectSelectionReplaced";
  readonly "operation": "SetObjectSelection";
  readonly "receipt": ObjectSelectionSetReceipt;
};
/** Emit only when a previously valid INSPECTED snapshot is invalidated by an observed different world revision. receipt contains the prior successful ObjectInspection with the now-invalid snapshot; it is neither new facts nor a new successful inspect. newWorldRevision is the actually observed revision, unequal to receipt.result.worldRevision. An InspectObject query alone need not emit; consumer must discard prior facts for later painter/apply. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type ObjectInspectionInvalidated = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "ObjectInspectionInvalidated";
  readonly "operation": "InspectObject";
  readonly "receipt": ObjectInspection;
  readonly "newWorldRevision": Revision;
};
/** Emit after successful complete analysis at bound revisions; receipt.result is that immutable analysis. No event for incomplete/stale/failed analysis. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type AffectedObjectAnalysisReady = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "AffectedObjectAnalysisReady";
  readonly "operation": "AnalyzeAffectedObjects";
  readonly "receipt": AffectedObjectAnalysis;
};
/** Emit only for successful policy decision BLOCK_AND_NOTIFY on nonselected affected objects; receipt.result carries the displayed immutable affected set/decision revision. NO_NOTIFICATION/CONTINUE/CANCEL do not emit this signal. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type AffectedObjectNotificationRequired = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "AffectedObjectNotificationRequired";
  readonly "operation": "DecideAffectedObjectNotification";
  readonly "receipt": AffectedObjectNotificationDecision;
};
/** Emit only after actual apply has reached APPLIED_PENDING_READBACK; receipt.result is the matching pending transaction receipt. This signal is not verified world/product success and never advances history. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type TransactionAppliedPendingReadback = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "TransactionAppliedPendingReadback";
  readonly "operation": "ApplyRecoverableCommit";
  readonly "receipt": RecoverableCommitAppliedReceipt;
};
/** Emit only after full matched readback and durable linked history, status VERIFIED. receipt.result is the final verified transaction receipt; pending/restore failure/history persist failure never emits. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type TransactionVerified = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "TransactionVerified";
  readonly "operation": "Readback";
  readonly "receipt": CanvasReadbackReceipt;
};
/** Emit only after the whole linked Undo or Redo transaction is VERIFIED with durable movement of all linked heads; operation Undo/Redo is the finite signal discriminator/direction. receipt.result is that verified receipt. Conflict proposal, rollback/failure and unchanged heads emit nothing. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type HistoryPositionChanged = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "HistoryPositionChanged";
  readonly "operation": "Undo";
  readonly "receipt": UndoReceipt;
} | {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "HistoryPositionChanged";
  readonly "operation": "Redo";
  readonly "receipt": RedoReceipt;
};
/** Emit only after an actual durable linked history inventory/head change; receipt.result is the new safe history snapshot. HistoryQuery read alone need not emit. | receipt is a typed public response envelope; receipt.error=null and receipt.result nonnull; authenticate subscriptions and preserve normal response privacy/scope; no new digest kind */
export type HistoryInventoryChanged = {
  readonly "contractVersion": "canvas/v4";
  readonly "event": "HistoryInventoryChanged";
  readonly "operation": "HistoryQuery";
  readonly "receipt": ObjectHistoryView;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type BuildDocumentResponse = {
  readonly "contractVersion": "BUILD/V2";
  readonly "requestId": Ref;
  readonly "result": CompiledOperationSet | null;
  readonly "error": Error | null;
};
export type HistoryOperationProjection = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "worldRef": Ref;
  readonly "originTransactionId": Ref;
  readonly "transactionId": Ref;
  readonly "direction": HistoryDirection;
  readonly "affectedObjectRefs": RefSet;
  readonly "originVerifiedReceiptDigest": Digest;
  readonly "originBeforeImageDigest": Digest;
  readonly "originBeforeStateReadbackDigest": Digest;
  readonly "originAfterReadbackDigest": Digest;
  readonly "expectedCurrentStateDigest": Digest;
  readonly "targetStateDigest": Digest;
  readonly "expectedHistoryRevision": Revision;
  readonly "expectedWorldRevision": Revision;
  readonly "expectedObjectRevisions": ObjectRevisions;
  readonly "guarantee": Guarantee;
};
export type PreparedHistoryTransaction = {
  readonly "originTransactionId": Ref;
  readonly "transactionId": Ref;
  readonly "direction": HistoryDirection;
  readonly "historyOperationDigest": Digest;
  readonly "transactionPayloadDigest": Digest;
  readonly "beforeImageDigest": Digest;
  readonly "targetStateDigest": Digest;
  readonly "protectedPositions": Positions;
  readonly "stateProfile": StateProfile;
  readonly "adapterExecutionRevision": Revision;
  readonly "guarantee": Guarantee;
  readonly "status": "PREPARED";
};
export type QueryPreparedTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "operationDigest": Digest;
  readonly "authorizationBindingDigest": Digest;
};
export type QueryPreparedTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": PreparedTransactionResult | null;
  readonly "error": Error | null;
};
export type PrepareHistoryTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "originTransactionId": Ref;
  readonly "transactionId": Ref;
  readonly "direction": HistoryDirection;
  readonly "affectedObjectRefs": RefSet;
  readonly "originVerifiedReceiptDigest": Digest;
  readonly "originBeforeImageDigest": Digest;
  readonly "originBeforeStateReadbackDigest": Digest;
  readonly "originAfterReadbackDigest": Digest;
  readonly "expectedHistoryRevision": Revision;
  readonly "expectedWorldRevision": Revision;
  readonly "expectedObjectRevisions": ObjectRevisions;
  readonly "expectedCurrentStateDigest": Digest;
  readonly "targetStateDigest": Digest;
  readonly "historyOperationDigest": Digest;
  readonly "authorizationBinding": AuthProjection;
  readonly "guarantee": Guarantee;
};
export type PrepareHistoryTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": PreparedHistoryTransaction | null;
  readonly "error": Error | null;
};
export type QueryPreparedHistoryTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "originTransactionId": Ref;
  readonly "transactionId": Ref;
  readonly "direction": HistoryDirection;
  readonly "historyOperationDigest": Digest;
  readonly "authorizationBindingDigest": Digest;
};
export type QueryPreparedHistoryTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": PreparedHistoryTransaction | null;
  readonly "error": Error | null;
};
export type ApplyHistoryTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "originTransactionId": Ref;
  readonly "transactionId": Ref;
  readonly "direction": HistoryDirection;
  readonly "authorizationBinding": AuthProjection;
  readonly "historyOperationDigest": Digest;
  readonly "expectedWorldRevision": Revision;
  readonly "expectedObjectRevisions": ObjectRevisions;
  readonly "preparedHistoryTransaction": PreparedHistoryTransaction;
};
export type ApplyHistoryTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": ReceiptProjection | null;
  readonly "error": Error | null;
};
export type PreparedAbortResult = {
  readonly "transactionId": Ref;
  readonly "status": "ABORTED_PREPARED";
  readonly "mutationState": "NONE";
};
export type AbortPreparedTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "transactionId": Ref;
  readonly "operationDigest": Digest;
  readonly "authorizationBindingDigest": Digest;
  readonly "serviceRecoveryRef": Ref;
};
export type AbortPreparedTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": PreparedAbortResult | null;
  readonly "error": Error | null;
};
export type AbortPreparedHistoryTransactionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "originTransactionId": Ref;
  readonly "transactionId": Ref;
  readonly "historyOperationDigest": Digest;
  readonly "authorizationBindingDigest": Digest;
  readonly "serviceRecoveryRef": Ref;
};
export type AbortPreparedHistoryTransactionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": PreparedAbortResult | null;
  readonly "error": Error | null;
};
/** response-only; compute readback digest from same durable saved before image before PREPARED response | QueryPrepared returns identical saved digest; no live world recomputation | ApplyCompiledTransactionRequest.preparedTransaction remains seven-field PreparedTransaction */
export type PreparedTransactionResult = {
  readonly "payload": TxProjection;
  readonly "transactionPayloadDigest": Digest;
  readonly "beforeImageDigest": Digest;
  readonly "guarantee": Guarantee;
  readonly "stateProfile": StateProfile;
  readonly "protectedPositions": Positions;
  readonly "adapterExecutionRevision": Revision;
  readonly "beforeStateReadbackDigest": Digest;
};
export type PlacementSettingName = "placement.forwardSearchCells" | "placement.frontGapCells" | "placement.lateralSearchCells" | "placement.verticalSearchCells";
/** Order: UTF16 ascending */
export type PlacementSettingNames = ReadonlyArray<PlacementSettingName>;
/** Canvas-owned per bound world; edited and shown in the Shell management interface; defaults 2/16/8/4 are user-decided values (authority/first-placement-user-decision.md) | unset or invalid stored values are never defaulted: CAPABILITY_UNAVAILABLE/validate/POLICY_UNAVAILABLE with unavailableSettings */
export type PlacementSettings = {
  readonly "frontGapCells": NonNegativeInt;
  readonly "forwardSearchCells": NonNegativeInt;
  readonly "lateralSearchCells": NonNegativeInt;
  readonly "verticalSearchCells": NonNegativeInt;
  readonly "settingsRevision": Revision;
};
/** from ConfirmedIntent.dimensions in node units; Workshop asks when unknown or non-integer; never enlarged silently */
export type PlacementFootprint = {
  readonly "widthCells": PositiveInt;
  readonly "depthCells": PositiveInt;
  readonly "heightCells": PositiveInt;
};
export type PlacementAnchorKind = "DEFAULT_PLAYER" | "NAMED_PLAYER" | "PICKED_POINT";
/** DEFAULT_PLAYER: Adapter relay record for invocationId in the same session/world -> that initiating player (Luanti-started); otherwise Shell-started -> exactly one online player, none NO_ONLINE_PLAYER, several MULTIPLE_ONLINE_PLAYERS | no caller-supplied position, facing or initiator name exists in any variant */
export type PlacementAnchor = {
  readonly "kind": "DEFAULT_PLAYER";
  readonly "invocationId": Ref;
} | {
  readonly "kind": "NAMED_PLAYER";
  readonly "engineActorName": Ref;
} | {
  readonly "kind": "PICKED_POINT";
  readonly "pickRef": Ref;
};
export type PlacementChoiceReason = "FACING_AMBIGUOUS" | "FRONT_AREA_BODY_OCCUPIED" | "FRONT_AREA_NO_GROUND" | "FRONT_AREA_OCCUPIED" | "FRONT_AREA_PROTECTED" | "FRONT_AREA_UNKNOWN" | "MULTIPLE_ONLINE_PLAYERS" | "NO_ONLINE_PLAYER" | "PLAYER_OFFLINE";
/** Order: UTF16 ascending */
export type PlacementChoiceReasons = ReadonlyArray<PlacementChoiceReason>;
export type PlacementOption = "NAME_PLAYER" | "PICK_WORLD_POINT";
/** Order: fixed NAME_PLAYER then PICK_WORLD_POINT */
export type PlacementOptions = ReadonlyArray<PlacementOption>;
/** typed outcome, not an error; no bounds, positions or facing | candidatePlayerNames nonnull only with MULTIPLE_ONLINE_PLAYERS and only to a principal currently authorized for INSPECT on the bound world | options: reasons include MULTIPLE_ONLINE_PLAYERS -> [NAME_PLAYER, PICK_WORLD_POINT] (NAME_PLAYER is the tappable candidatePlayerNames list returned through SELECT_CHOICE); every other reason -> [PICK_WORLD_POINT] only (rc.9 user decision authority/USER_DECISION_PLACEMENT_ASK_OPTIONS_2026-10-02.json) */
export type PlacementChoiceRequired = {
  readonly "anchorKind": PlacementAnchorKind;
  readonly "reasons": PlacementChoiceReasons;
  readonly "options": PlacementOptions;
  readonly "candidatePlayerNames": RefSet | null;
  readonly "placementSettings": PlacementSettings;
  readonly "observedWorldRevision": Revision;
};
/** targetFacts.source=REGION_INSPECTED; targetFactsDigest=D(target-facts,targetFacts); targetFacts.frameDigest=D(frame,frame) computed by the Adapter | sampledBounds = chosen footprint plus support layer; protected/body lists cover every such cell for the acting principal at observation time | entranceFacing is the horizontal axis opposite the anchor facing; no raw pose */
export type RegionInspection = {
  readonly "inspectionId": Ref;
  readonly "anchorKind": PlacementAnchorKind;
  readonly "targetFacts": TargetFacts;
  readonly "targetFactsDigest": Digest;
  readonly "frame": Frame;
  readonly "evidence": EvidenceBinding;
  readonly "protectedPositions": Positions;
  readonly "bodyOccupiedPositions": Positions;
  readonly "entranceFacing": Axis;
  readonly "placementSettings": PlacementSettings;
};
export type PlacementOutcomeKind = "PLACEMENT_CHOICE_REQUIRED" | "REGION_INSPECTED";
export type PlacementOutcome = {
  readonly "outcome": "REGION_INSPECTED";
  readonly "inspection": RegionInspection;
} | {
  readonly "outcome": "PLACEMENT_CHOICE_REQUIRED";
  readonly "choice": PlacementChoiceRequired;
};
/** caller is Canvas only; inspectionId Canvas-generated and durably reserved | read-only: zero world writes */
export type InspectRegionRequest = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "expectedWorldRevision": Revision;
  readonly "inspectionId": Ref;
  readonly "anchor": PlacementAnchor;
  readonly "footprint": PlacementFootprint;
  readonly "placementSettings": PlacementSettings;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result */
export type InspectRegionResponse = {
  readonly "contractVersion": "world-adapter/v4";
  readonly "requestId": Ref;
  readonly "result": PlacementOutcome | null;
  readonly "error": Error | null;
};
export type InspectPlacementRegionRequest = {
  readonly "contractVersion": "canvas/v4";
  readonly "actorRef": Ref;
  readonly "sessionRef": Ref;
  readonly "requestId": Ref;
  readonly "authorizationRef": Ref;
  readonly "worldRef": Ref;
  readonly "anchor": PlacementAnchor;
  readonly "footprint": PlacementFootprint;
};
/** exactly one of result/error nonnull; transport success never substitutes domain result | result is the Adapter outcome relayed unchanged after Canvas durably records it | unavailableSettings nonnull exactly when error is CAPABILITY_UNAVAILABLE/POLICY_UNAVAILABLE for a placement setting */
export type PlacementRegionInspection = {
  readonly "contractVersion": "canvas/v4";
  readonly "requestId": Ref;
  readonly "result": PlacementOutcome | null;
  readonly "error": Error | null;
  readonly "unavailableSettings": PlacementSettingNames | null;
};
export type RegionApplyBinding = {
  readonly "inspectionId": Ref;
  readonly "build": BuildProjection;
};
/** display label only; no positions, coordinates, metadata or hidden fields */
export type ActionChoice = {
  readonly "value": Ref;
  readonly "label": Text;
};
/** Order: renderer declared order */
export type ActionChoices = ReadonlyArray<ActionChoice>;
/** Order: UTF16 ascending */
export type WireVersions = ReadonlyArray<Ref>;
/** Order: UTF16 ascending */
export type FactProfiles = ReadonlyArray<Ref>;
/** exchanged by every provider/consumer pair before any request | every wire the consumer needs must be advertised with the same major; every fact profile the consumer may send must be advertised; otherwise UNSUPPORTED_VERSION/decode/VERSION_UNSUPPORTED/NONE, zero requests, no fallback or downgrade | contracts@0.3.0 advertises interaction-surface/v3, world-adapter/v4, canvas/v4, session/v2, painter/v3, ReferenceBrief/v2, BUILD/V2 and factProfiles target-facts/v2 + target-facts/v3; contracts@0.2.1 advertises the v2/v3 set and target-facts/v2 only */
export type ContractHandshake = {
  readonly "contracts": Ref;
  readonly "wireVersions": WireVersions;
  readonly "compiledOperationsVersion": "operations/v2";
  readonly "factProfiles": FactProfiles;
};

export interface TypeMap {
  readonly Ref: Ref;
  readonly Revision: Revision;
  readonly Digest: Digest;
  readonly Text: Text;
  readonly SafeInt: SafeInt;
  readonly NonNegativeInt: NonNegativeInt;
  readonly PositiveInt: PositiveInt;
  readonly Finite: Finite;
  readonly NonNegativeFinite: NonNegativeFinite;
  readonly PositiveFinite: PositiveFinite;
  readonly Bool: Bool;
  readonly Position: Position;
  readonly Box: Box;
  readonly NodeSpec: NodeSpec;
  readonly Byte: Byte;
  readonly Axis: Axis;
  readonly Axes: Axes;
  readonly GridUnit: GridUnit;
  readonly Frame: Frame;
  readonly Handedness: Handedness;
  readonly CollisionBox: CollisionBox;
  readonly CollisionBoxes: CollisionBoxes;
  readonly Param2s: Param2s;
  readonly FieldNames: FieldNames;
  readonly Liquid: Liquid;
  readonly NodeCapability: NodeCapability;
  readonly ModRevisions: ModRevisions;
  readonly NodeMap: NodeMap;
  readonly Catalogue: Catalogue;
  readonly AvatarDimensions: AvatarDimensions;
  readonly HazardPolicy: HazardPolicy;
  readonly LightRule: LightRule;
  readonly SafetyProfile: SafetyProfile;
  readonly CompilationConfig: CompilationConfig;
  readonly Effect: Effect;
  readonly Effects: Effects;
  readonly Positions: Positions;
  readonly RefSet: RefSet;
  readonly OrderedRefs: OrderedRefs;
  readonly FinalEffects: FinalEffects;
  readonly Coverage: Coverage;
  readonly OccupiedCell: OccupiedCell;
  readonly OccupiedCells: OccupiedCells;
  readonly UnknownReason: UnknownReason;
  readonly UnknownCell: UnknownCell;
  readonly UnknownCells: UnknownCells;
  readonly Portal: Portal;
  readonly Portals: Portals;
  readonly UsableVolume: UsableVolume;
  readonly FactsSource: FactsSource;
  readonly TargetFacts: TargetFacts;
  readonly MaterialMap: MaterialMap;
  readonly SetBox: SetBox;
  readonly BuildOps: BuildOps;
  readonly EvidenceBinding: EvidenceBinding;
  readonly CoverageWitness: CoverageWitness;
  readonly ProtectionWitness: ProtectionWitness;
  readonly BodyWitness: BodyWitness;
  readonly EntranceWitness: EntranceWitness;
  readonly PositionPath: PositionPath;
  readonly HazardWitness: HazardWitness;
  readonly Witness: Witness;
  readonly WitnessPredicate: WitnessPredicate;
  readonly Witnesses: Witnesses;
  readonly BuildProjection: BuildProjection;
  readonly OperationsProjection: OperationsProjection;
  readonly MediaType: MediaType;
  readonly MediaBinding: MediaBinding;
  readonly Media: Media;
  readonly Controls: Controls;
  readonly BriefProjection: BriefProjection;
  readonly ConfirmedIntent: ConfirmedIntent;
  readonly IntentKind: IntentKind;
  readonly IntentProjection: IntentProjection;
  readonly AffectedProjection: AffectedProjection;
  readonly ActionProjection: ActionProjection;
  readonly AllowedAction: AllowedAction;
  readonly Actions: Actions;
  readonly VerifiedBinding: VerifiedBinding;
  readonly AuthProjection: AuthProjection;
  readonly ObjectRevisions: ObjectRevisions;
  readonly TxProjection: TxProjection;
  readonly Phase: Phase;
  readonly Retryability: Retryability;
  readonly MutationState: MutationState;
  readonly ErrorCode: ErrorCode;
  readonly ErrorReason: ErrorReason;
  readonly Error: Error;
  readonly ReceiptStatus: ReceiptStatus;
  readonly RestoreStatus: RestoreStatus;
  readonly ReceiptProjection: ReceiptProjection;
  readonly ResourcePurpose: ResourcePurpose;
  readonly Resource: Resource;
  readonly Resources: Resources;
  readonly SavedResources: SavedResources;
  readonly StringMap: StringMap;
  readonly InventorySlots: InventorySlots;
  readonly Inventory: Inventory;
  readonly Timer: Timer;
  readonly Record: Record;
  readonly Records: Records;
  readonly NodeFields: NodeFields;
  readonly StateProfile: StateProfile;
  readonly BeforeImage: BeforeImage;
  readonly ReadbackProjection: ReadbackProjection;
  readonly Limit: Limit;
  readonly LimitKind: LimitKind;
  readonly PublicCapabilities: PublicCapabilities;
  readonly Guarantee: Guarantee;
  readonly Limits: Limits;
  readonly MediaTypes: MediaTypes;
  readonly Metadata: Metadata;
  readonly CurrentContext: CurrentContext;
  readonly Readiness: Readiness;
  readonly ConnectionDescriptor: ConnectionDescriptor;
  readonly Connections: Connections;
  readonly ObjectRecord: ObjectRecord;
  readonly Objects: Objects;
  readonly ConnectionInventory: ConnectionInventory;
  readonly ObjectInventory: ObjectInventory;
  readonly ObjectSelection: ObjectSelection;
  readonly ObjectNameReceipt: ObjectNameReceipt;
  readonly DecisionKind: DecisionKind;
  readonly AffectedDecision: AffectedDecision;
  readonly HistoryEntry: HistoryEntry;
  readonly HistoryEntries: HistoryEntries;
  readonly HistoryView: HistoryView;
  readonly ConflictProposal: ConflictProposal;
  readonly HistoryDirection: HistoryDirection;
  readonly ConflictChoice: ConflictChoice;
  readonly ConflictChoices: ConflictChoices;
  readonly ClarificationNeed: ClarificationNeed;
  readonly BuildPlan: BuildPlan;
  readonly PreparedTransaction: PreparedTransaction;
  readonly SessionSnapshot: SessionSnapshot;
  readonly TurnRecord: TurnRecord;
  readonly TurnRecords: TurnRecords;
  readonly TurnReceipt: TurnReceipt;
  readonly DeleteSessionReceipt: DeleteSessionReceipt;
  readonly SavedResourceReceipt: SavedResourceReceipt;
  readonly ReopenedArtifact: ReopenedArtifact;
  readonly ActionInputKind: ActionInputKind;
  readonly ActionInput: ActionInput;
  readonly ActionInputKinds: ActionInputKinds;
  readonly ActionDescriptor: ActionDescriptor;
  readonly ActionDescriptors: ActionDescriptors;
  readonly InteractionFrame: InteractionFrame;
  readonly ActionReceipt: ActionReceipt;
  readonly BriefReceipt: BriefReceipt;
  readonly CompiledOperationSet: CompiledOperationSet;
  readonly ConnectionWorldPayloadReceipt: ConnectionWorldPayloadReceipt;
  readonly AdapterReadback: AdapterReadback;
  readonly ListWorldConnectionsRequest: ListWorldConnectionsRequest;
  readonly WorldConnectionList: WorldConnectionList;
  readonly SelectWorldConnectionRequest: SelectWorldConnectionRequest;
  readonly WorldConnectionSelectedReceipt: WorldConnectionSelectedReceipt;
  readonly SwitchWorldConnectionRequest: SwitchWorldConnectionRequest;
  readonly WorldConnectionSwitchedReceipt: WorldConnectionSwitchedReceipt;
  readonly ListObjectsRequest: ListObjectsRequest;
  readonly ObjectList: ObjectList;
  readonly CreateObjectRequest: CreateObjectRequest;
  readonly ObjectCreatedReceipt: ObjectCreatedReceipt;
  readonly NameObjectRequest: NameObjectRequest;
  readonly ObjectNamedReceipt: ObjectNamedReceipt;
  readonly RenameObjectRequest: RenameObjectRequest;
  readonly ObjectRenamedReceipt: ObjectRenamedReceipt;
  readonly SetObjectSelectionRequest: SetObjectSelectionRequest;
  readonly ObjectSelectionSetReceipt: ObjectSelectionSetReceipt;
  readonly InspectObjectRequest: InspectObjectRequest;
  readonly ObjectInspection: ObjectInspection;
  readonly AnalyzeAffectedObjectsRequest: AnalyzeAffectedObjectsRequest;
  readonly AffectedObjectAnalysis: AffectedObjectAnalysis;
  readonly DecideAffectedObjectNotificationRequest: DecideAffectedObjectNotificationRequest;
  readonly AffectedObjectNotificationDecision: AffectedObjectNotificationDecision;
  readonly ApplyRecoverableCommitRequest: ApplyRecoverableCommitRequest;
  readonly RecoverableCommitAppliedReceipt: RecoverableCommitAppliedReceipt;
  readonly CanvasReadbackRequest: CanvasReadbackRequest;
  readonly CanvasReadbackReceipt: CanvasReadbackReceipt;
  readonly UndoRequest: UndoRequest;
  readonly UndoReceipt: UndoReceipt;
  readonly RedoRequest: RedoRequest;
  readonly RedoReceipt: RedoReceipt;
  readonly HistoryQuery: HistoryQuery;
  readonly ObjectHistoryView: ObjectHistoryView;
  readonly DiscoverConnectionsRequest: DiscoverConnectionsRequest;
  readonly DiscoverConnectionsResponse: DiscoverConnectionsResponse;
  readonly ListWorldsRequest: ListWorldsRequest;
  readonly ListWorldsResponse: ListWorldsResponse;
  readonly AuthorizeBindingRequest: AuthorizeBindingRequest;
  readonly AuthorizeBindingResponse: AuthorizeBindingResponse;
  readonly InspectWorldRequest: InspectWorldRequest;
  readonly InspectWorldResponse: InspectWorldResponse;
  readonly PrepareRecoverableTransactionRequest: PrepareRecoverableTransactionRequest;
  readonly PrepareRecoverableTransactionResponse: PrepareRecoverableTransactionResponse;
  readonly ApplyCompiledTransactionRequest: ApplyCompiledTransactionRequest;
  readonly ApplyCompiledTransactionResponse: ApplyCompiledTransactionResponse;
  readonly ReadbackRequest: ReadbackRequest;
  readonly ReadbackResponse: ReadbackResponse;
  readonly QueryTransactionRequest: QueryTransactionRequest;
  readonly QueryTransactionResponse: QueryTransactionResponse;
  readonly RestoreTransactionRequest: RestoreTransactionRequest;
  readonly RestoreTransactionResponse: RestoreTransactionResponse;
  readonly InvokeActionRequest: InvokeActionRequest;
  readonly InvokeActionResponse: InvokeActionResponse;
  readonly StartOrResumeSessionRequest: StartOrResumeSessionRequest;
  readonly StartOrResumeSessionResponse: StartOrResumeSessionResponse;
  readonly AppendMultimodalTurnRequest: AppendMultimodalTurnRequest;
  readonly AppendMultimodalTurnResponse: AppendMultimodalTurnResponse;
  readonly AnswerClarificationRequest: AnswerClarificationRequest;
  readonly AnswerClarificationResponse: AnswerClarificationResponse;
  readonly SwitchWorldContextRequest: SwitchWorldContextRequest;
  readonly SwitchWorldContextResponse: SwitchWorldContextResponse;
  readonly RecordActionReceiptRequest: RecordActionReceiptRequest;
  readonly RecordActionReceiptResponse: RecordActionReceiptResponse;
  readonly DeleteSessionRequest: DeleteSessionRequest;
  readonly DeleteSessionResponse: DeleteSessionResponse;
  readonly PersistRequiredArtifactResourcesRequest: PersistRequiredArtifactResourcesRequest;
  readonly PersistRequiredArtifactResourcesResponse: PersistRequiredArtifactResourcesResponse;
  readonly ReopenExistingArtifactRequest: ReopenExistingArtifactRequest;
  readonly ReopenExistingArtifactResponse: ReopenExistingArtifactResponse;
  readonly PainterId: PainterId;
  readonly CreateBuildPlanRequest: CreateBuildPlanRequest;
  readonly CreateBuildPlanResponse: CreateBuildPlanResponse;
  readonly BindReferenceBriefRequest: BindReferenceBriefRequest;
  readonly BindReferenceBriefResponse: BindReferenceBriefResponse;
  readonly ReferenceBriefRequest: ReferenceBriefRequest;
  readonly ReferenceBriefResponse: ReferenceBriefResponse;
  readonly BuildDocumentRequest: BuildDocumentRequest;
  readonly WorldConnectionInventoryChanged: WorldConnectionInventoryChanged;
  readonly WorldConnectionSelectionChanged: WorldConnectionSelectionChanged;
  readonly ActiveWorldChanged: ActiveWorldChanged;
  readonly ObjectInventoryChanged: ObjectInventoryChanged;
  readonly ObjectCreated: ObjectCreated;
  readonly ObjectNameChanged: ObjectNameChanged;
  readonly ActiveObjectSelectionReplaced: ActiveObjectSelectionReplaced;
  readonly ObjectInspectionInvalidated: ObjectInspectionInvalidated;
  readonly AffectedObjectAnalysisReady: AffectedObjectAnalysisReady;
  readonly AffectedObjectNotificationRequired: AffectedObjectNotificationRequired;
  readonly TransactionAppliedPendingReadback: TransactionAppliedPendingReadback;
  readonly TransactionVerified: TransactionVerified;
  readonly HistoryPositionChanged: HistoryPositionChanged;
  readonly HistoryInventoryChanged: HistoryInventoryChanged;
  readonly BuildDocumentResponse: BuildDocumentResponse;
  readonly HistoryOperationProjection: HistoryOperationProjection;
  readonly PreparedHistoryTransaction: PreparedHistoryTransaction;
  readonly QueryPreparedTransactionRequest: QueryPreparedTransactionRequest;
  readonly QueryPreparedTransactionResponse: QueryPreparedTransactionResponse;
  readonly PrepareHistoryTransactionRequest: PrepareHistoryTransactionRequest;
  readonly PrepareHistoryTransactionResponse: PrepareHistoryTransactionResponse;
  readonly QueryPreparedHistoryTransactionRequest: QueryPreparedHistoryTransactionRequest;
  readonly QueryPreparedHistoryTransactionResponse: QueryPreparedHistoryTransactionResponse;
  readonly ApplyHistoryTransactionRequest: ApplyHistoryTransactionRequest;
  readonly ApplyHistoryTransactionResponse: ApplyHistoryTransactionResponse;
  readonly PreparedAbortResult: PreparedAbortResult;
  readonly AbortPreparedTransactionRequest: AbortPreparedTransactionRequest;
  readonly AbortPreparedTransactionResponse: AbortPreparedTransactionResponse;
  readonly AbortPreparedHistoryTransactionRequest: AbortPreparedHistoryTransactionRequest;
  readonly AbortPreparedHistoryTransactionResponse: AbortPreparedHistoryTransactionResponse;
  readonly PreparedTransactionResult: PreparedTransactionResult;
  readonly PlacementSettingName: PlacementSettingName;
  readonly PlacementSettingNames: PlacementSettingNames;
  readonly PlacementSettings: PlacementSettings;
  readonly PlacementFootprint: PlacementFootprint;
  readonly PlacementAnchorKind: PlacementAnchorKind;
  readonly PlacementAnchor: PlacementAnchor;
  readonly PlacementChoiceReason: PlacementChoiceReason;
  readonly PlacementChoiceReasons: PlacementChoiceReasons;
  readonly PlacementOption: PlacementOption;
  readonly PlacementOptions: PlacementOptions;
  readonly PlacementChoiceRequired: PlacementChoiceRequired;
  readonly RegionInspection: RegionInspection;
  readonly PlacementOutcomeKind: PlacementOutcomeKind;
  readonly PlacementOutcome: PlacementOutcome;
  readonly InspectRegionRequest: InspectRegionRequest;
  readonly InspectRegionResponse: InspectRegionResponse;
  readonly InspectPlacementRegionRequest: InspectPlacementRegionRequest;
  readonly PlacementRegionInspection: PlacementRegionInspection;
  readonly RegionApplyBinding: RegionApplyBinding;
  readonly ActionChoice: ActionChoice;
  readonly ActionChoices: ActionChoices;
  readonly WireVersions: WireVersions;
  readonly FactProfiles: FactProfiles;
  readonly ContractHandshake: ContractHandshake;
}
export type TypeName = keyof TypeMap;
export type WireVersion = "interaction-surface/v3" | "world-adapter/v4" | "canvas/v4" | "session/v2" | "painter/v3" | "ReferenceBrief/v2" | "BUILD/V2";
export type FactProfile = "target-facts/v2" | "target-facts/v3";
export interface OperationMap {
  readonly "interaction-surface/v3": {
    readonly "InvokeAction": { readonly request: InvokeActionRequest; readonly response: InvokeActionResponse; };
  };
  readonly "session/v2": {
    readonly "StartOrResumeSession": { readonly request: StartOrResumeSessionRequest; readonly response: StartOrResumeSessionResponse; };
    readonly "AppendMultimodalTurn": { readonly request: AppendMultimodalTurnRequest; readonly response: AppendMultimodalTurnResponse; };
    readonly "AnswerClarification": { readonly request: AnswerClarificationRequest; readonly response: AnswerClarificationResponse; };
    readonly "SwitchWorldContext": { readonly request: SwitchWorldContextRequest; readonly response: SwitchWorldContextResponse; };
    readonly "RecordActionReceipt": { readonly request: RecordActionReceiptRequest; readonly response: RecordActionReceiptResponse; };
    readonly "DeleteSession": { readonly request: DeleteSessionRequest; readonly response: DeleteSessionResponse; };
    readonly "PersistRequiredArtifactResources": { readonly request: PersistRequiredArtifactResourcesRequest; readonly response: PersistRequiredArtifactResourcesResponse; };
    readonly "ReopenExistingArtifact": { readonly request: ReopenExistingArtifactRequest; readonly response: ReopenExistingArtifactResponse; };
  };
  readonly "painter/v3": {
    readonly "CreateBuildPlan": { readonly request: CreateBuildPlanRequest; readonly response: CreateBuildPlanResponse | ClarificationNeed; };
  };
  readonly "ReferenceBrief/v2": {
    readonly "BindReferenceBrief": { readonly request: BindReferenceBriefRequest; readonly response: BindReferenceBriefResponse; };
    readonly "ReferenceBrief": { readonly request: ReferenceBriefRequest; readonly response: ReferenceBriefResponse; };
  };
  readonly "BUILD/V2": {
    readonly "BuildDocument": { readonly request: BuildDocumentRequest; readonly response: BuildDocumentResponse; };
  };
  readonly "canvas/v4": {
    readonly "ListWorldConnections": { readonly request: ListWorldConnectionsRequest; readonly response: WorldConnectionList; };
    readonly "SelectWorldConnection": { readonly request: SelectWorldConnectionRequest; readonly response: WorldConnectionSelectedReceipt; };
    readonly "SwitchWorldConnection": { readonly request: SwitchWorldConnectionRequest; readonly response: WorldConnectionSwitchedReceipt; };
    readonly "ListObjects": { readonly request: ListObjectsRequest; readonly response: ObjectList; };
    readonly "CreateObject": { readonly request: CreateObjectRequest; readonly response: ObjectCreatedReceipt; };
    readonly "NameObject": { readonly request: NameObjectRequest; readonly response: ObjectNamedReceipt; };
    readonly "RenameObject": { readonly request: RenameObjectRequest; readonly response: ObjectRenamedReceipt; };
    readonly "SetObjectSelection": { readonly request: SetObjectSelectionRequest; readonly response: ObjectSelectionSetReceipt; };
    readonly "InspectObject": { readonly request: InspectObjectRequest; readonly response: ObjectInspection; };
    readonly "AnalyzeAffectedObjects": { readonly request: AnalyzeAffectedObjectsRequest; readonly response: AffectedObjectAnalysis; };
    readonly "DecideAffectedObjectNotification": { readonly request: DecideAffectedObjectNotificationRequest; readonly response: AffectedObjectNotificationDecision; };
    readonly "ApplyRecoverableCommit": { readonly request: ApplyRecoverableCommitRequest; readonly response: RecoverableCommitAppliedReceipt; };
    readonly "Readback": { readonly request: CanvasReadbackRequest; readonly response: CanvasReadbackReceipt; };
    readonly "Undo": { readonly request: UndoRequest; readonly response: UndoReceipt; };
    readonly "Redo": { readonly request: RedoRequest; readonly response: RedoReceipt; };
    readonly "HistoryQuery": { readonly request: HistoryQuery; readonly response: ObjectHistoryView; };
    readonly "InspectPlacementRegion": { readonly request: InspectPlacementRegionRequest; readonly response: PlacementRegionInspection; };
  };
  readonly "world-adapter/v4": {
    readonly "DiscoverConnections": { readonly request: DiscoverConnectionsRequest; readonly response: DiscoverConnectionsResponse; };
    readonly "ListWorlds": { readonly request: ListWorldsRequest; readonly response: ListWorldsResponse; };
    readonly "AuthorizeBinding": { readonly request: AuthorizeBindingRequest; readonly response: AuthorizeBindingResponse; };
    readonly "InspectWorld": { readonly request: InspectWorldRequest; readonly response: InspectWorldResponse; };
    readonly "PrepareRecoverableTransaction": { readonly request: PrepareRecoverableTransactionRequest; readonly response: PrepareRecoverableTransactionResponse; };
    readonly "ApplyCompiledTransaction": { readonly request: ApplyCompiledTransactionRequest; readonly response: ApplyCompiledTransactionResponse; };
    readonly "Readback": { readonly request: ReadbackRequest; readonly response: ReadbackResponse; };
    readonly "QueryTransaction": { readonly request: QueryTransactionRequest; readonly response: QueryTransactionResponse; };
    readonly "RestoreTransaction": { readonly request: RestoreTransactionRequest; readonly response: RestoreTransactionResponse; };
    readonly "QueryPreparedTransaction": { readonly request: QueryPreparedTransactionRequest; readonly response: QueryPreparedTransactionResponse; };
    readonly "PrepareHistoryTransaction": { readonly request: PrepareHistoryTransactionRequest; readonly response: PrepareHistoryTransactionResponse; };
    readonly "QueryPreparedHistoryTransaction": { readonly request: QueryPreparedHistoryTransactionRequest; readonly response: QueryPreparedHistoryTransactionResponse; };
    readonly "ApplyHistoryTransaction": { readonly request: ApplyHistoryTransactionRequest; readonly response: ApplyHistoryTransactionResponse; };
    readonly "AbortPreparedTransaction": { readonly request: AbortPreparedTransactionRequest; readonly response: AbortPreparedTransactionResponse; };
    readonly "AbortPreparedHistoryTransaction": { readonly request: AbortPreparedHistoryTransactionRequest; readonly response: AbortPreparedHistoryTransactionResponse; };
    readonly "InspectRegion": { readonly request: InspectRegionRequest; readonly response: InspectRegionResponse; };
  };
}
export interface ProjectionMap {
  readonly "build": BuildProjection;
  readonly "operations": OperationsProjection;
  readonly "reference-brief": BriefProjection;
  readonly "intent": IntentProjection;
  readonly "affected-analysis": AffectedProjection;
  readonly "authorization-binding": AuthProjection;
  readonly "transaction-payload": TxProjection;
  readonly "receipt": ReceiptProjection;
  readonly "frame": Frame;
  readonly "catalogue": Catalogue;
  readonly "safety-profile": SafetyProfile;
  readonly "compilation-config": CompilationConfig;
  readonly "final-effects": FinalEffects;
  readonly "coverage": Coverage;
  readonly "target-facts": TargetFacts;
  readonly "surface-action": ActionProjection;
  readonly "saved-work-resources": SavedResources;
  readonly "before-image": BeforeImage;
  readonly "readback": ReadbackProjection;
  readonly "history-operation": HistoryOperationProjection;
}
export type DigestKind = keyof ProjectionMap;
