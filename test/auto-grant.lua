-- Native API fixture only: these player objects do not claim a product login.
local saved = {}
local function fixture(world, singleplayer)
  local commands, callbacks, joins, revokes, forms, delayed = {}, {}, {}, {}, {}, {}
  local players, privs, exists = {}, {}, {}
  for _, name in ipairs({'admin', 'builder', 'visitor', 'singleplayer'}) do
    players[name] = {get_player_name = function() return name end}
    privs[name] = name == 'admin' and {server = true} or
      (name == 'builder' or name == 'singleplayer') and {interact = true, worldedit = true} or {}
    exists[name] = true
  end
  local core = {
    get_mod_storage = function() return {
      get_string = function(_, k) return saved[k] or '' end,
      set_string = function(_, k, v) saved[k] = v end} end,
    player_exists = function(name) return exists[name] == true end,
    is_singleplayer = function() return singleplayer == true end,
    get_player_by_name = function(name) return players[name] end,
    get_connected_players = function() local out = {}; for _, p in pairs(players) do out[#out+1]=p end; return out end,
    check_player_privs = function(who, required)
      local name = type(who) == 'string' and who or who:get_player_name()
      for k in pairs(required) do if not (privs[name] or {})[k] then return false end end
      return true
    end,
    register_chatcommand = function(name, spec) commands[name] = spec end,
    register_on_player_receive_fields = function(fn) callbacks[#callbacks+1] = fn end,
    register_on_joinplayer = function(fn) joins[#joins+1] = fn end,
    register_on_priv_revoke = function(fn) revokes[#revokes+1] = fn end,
    after = function(_, fn) delayed[#delayed+1] = fn end,
    show_formspec = function(name, form, spec) forms[name] = {form=form, spec=spec} end,
    formspec_escape = function(v) return v end,
    sha256 = function(v) return v:gsub('\n', ':') end,
    get_us_time = function() return 1234 end,
  }
  local grants = dofile('payload/hanaworlds_adapter/grant.lua').new(core, world, 'Fixture world')
  local function fields(name, v)
    for _, cb in ipairs(callbacks) do cb(players[name], 'hanaworlds:auto', v) end
  end
  local function toggle(name, enabled)
    assert(commands.hanaworlds_auto.func(name))
    fields(name, enabled and {hw_auto_enable=true} or {hw_auto_disable=true})
  end
  return {g=grants, core=core, players=players, privs=privs, exists=exists,
    commands=commands, fields=fields, toggle=toggle, joins=joins, revokes=revokes, forms=forms}
end
local f = fixture('luanti:one')
assert(f.commands.hanaworlds_auto, 'native automatic-mode command must exist')
assert(f.g:mode().enabled == false, 'default remains individual confirmation')
f.fields('admin', {hw_auto_enable=true})
assert(not f.g:mode().enabled, 'unseen form cannot enable')
f.toggle('builder', true)
assert(not f.g:mode().enabled, 'ordinary builder cannot enable')
assert(not f.forms.builder.spec:find('hw_auto_enable', 1, true), 'ordinary player sees read-only mode')
f.toggle('admin', true)
assert(f.g:mode().enabled and f.g:mode().enabledBy == 'admin', 'native server admin can enable')
assert(f.forms.admin.spec:find('Enabled', 1, true), 'native mode status is visible')
assert(f.g:verify('builder').current, 'permitted player needs no individual confirmation')
assert(not f.g:verify('visitor').current, 'automatic mode never supplies build privileges')
local first = f.g:verify('builder')
assert(first.worldRef == 'luanti:one' and first.engineActorName == 'builder'
  and first.scope == 'WORLD_BUILD_WITH_ENGINE_PROTECTION', 'proof remains bound to player/world/scope')
assert(f.g:verify('builder').grantRef == first.grantRef, 'current proof is stable')
assert(#f.g:list_current() == 2, 'only online builders appear')
local restarted = fixture('luanti:one')
assert(restarted.g:mode().enabled and restarted.g:verify('builder').grantRef == first.grantRef,
  'world-local mode and proof survive restart')
local other = fixture('luanti:other')
assert(not other.g:mode().enabled and not other.g:verify('builder').current, 'no cross-world mode or proof')
-- The other-world fixture shares storage deliberately; restore the persisted world.
f.toggle('admin', true)
first = f.g:verify('builder')
f.toggle('visitor', false)
assert(f.g:mode().enabled, 'ordinary player cannot disable')
f.toggle('admin', false)
assert(not f.g:verify('builder').current and not f.g:mode().enabled, 'disable immediately revokes automatic proofs')
f.toggle('admin', true)
assert(f.g:verify('builder').grantRef ~= first.grantRef, 'reenable never revives an old epoch')
first = f.g:verify('builder')
f.privs.builder.worldedit = nil
assert(not f.g:verify('builder').current, 'build privilege loss denies')
f.privs.builder.worldedit = true
assert(f.g:verify('builder').grantRef ~= first.grantRef, 'restored privilege gets fresh proof')
first = f.g:verify('builder')
f.revokes[1]('builder', 'admin', 'interact')
assert(f.g:verify('builder').grantRef ~= first.grantRef, 'revoke event invalidates the prior grant')
local player = f.players.builder
f.players.builder = nil
assert(not f.g:verify('builder').current, 'offline beneficiary denied')
f.players.builder = player
first = f.g:verify('builder')
f.joins[1](player, nil)
assert(f.g:verify('builder').grantRef ~= first.grantRef, 'new account cannot inherit old automatic proof')
f.privs.admin.server = nil
assert(not f.g:mode().enabled and not f.g:verify('builder').current, 'enabler authority loss disables world mode')
f.privs.admin.server = true
assert(not f.g:mode().enabled, 'authority restoration cannot resurrect mode')
f.toggle('admin', true)
f.exists.admin = false
assert(not f.g:mode().enabled, 'deleted admin identity disables mode')
f.exists.admin = true
f.toggle('admin', true)
f.joins[1](f.players.admin, nil)
assert(not f.g:mode().enabled, 'recreated admin account cannot inherit world toggle')
-- Loss between opening a form and its authenticated submission is checked again.
assert(f.commands.hanaworlds_auto.func('admin'))
f.privs.admin.server = nil
f.fields('admin', {hw_auto_enable=true})
assert(not f.g:mode().enabled, 'stale admin UI cannot enable after revocation')
f.privs.admin.server = true
f.toggle('admin', true)
assert(f.commands.hanaworlds_auto.func('admin'))
f.toggle('admin', false)
f.fields('admin', {hw_auto_enable=true, hw_auto_disable=true})
assert(not f.g:mode().enabled, 'unsolicited fields cannot change current mode')
-- Automatic proof enters the unchanged engine scope/protection barrier.
f.toggle('admin', true)
local bound_ref = f.g:verify('builder').grantRef
local nodes = {['0,0,0']={name='air',param1=0,param2=0}, ['1,0,0']={name='air',param1=0,param2=0}}
local writes = 0
local function key(pos) return pos.x .. ',' .. pos.y .. ',' .. pos.z end
_G.minetest = f.core
f.core.is_protected = function(pos) return pos.x == 1 end
f.core.get_node_or_nil = function(pos) return nodes[key(pos)] end
f.core.get_meta = function() return {to_table=function() return {fields={}, inventory={}} end} end
f.core.get_node_timer = function() return {get_timeout=function() return 0 end, get_elapsed=function() return 0 end} end
f.core.registered_nodes = {air={}, ['fixture:stone']={}}
f.core.fix_light = function() return true end
f.core.get_node_light = function() return 15 end
_G.worldedit = {set=function(pos, _, name)
  writes = writes + 1; nodes[key(pos)] = {name=name,param1=0,param2=0}; return 1
end, set_param2=function() return 1 end}
local engine = dofile('payload/hanaworlds_adapter/engine.lua').new({
  authorize=function(name) local proof=f.g:verify(name); return proof.current and proof.grantRef==bound_ref end,
  verifyPrepared=function() return true end})
local before = assert(engine:snapshot('builder', {{0,0,0}}))
local denied, reason = engine:apply('builder', {{position={1,0,0},nodeName='fixture:stone',param2=0}},
  {coveredPositions={{1,0,0}},records={{position={1,0,0},nodeName='air',param1=0,param2=0,metadata={},inventory={}}}},
  {status='PREPARED'})
assert(not denied and reason=='PERMISSION_DENIED' and writes==0, 'automatic proof cannot bypass protected cells')
f.toggle('admin', false)
denied, reason = engine:apply('builder', {{position={0,0,0},nodeName='fixture:stone',param2=0}}, before, {status='PREPARED'})
assert(not denied and reason=='PERMISSION_DENIED' and writes==0, 'disable after preparation prevents any write')
f.toggle('admin', true)
denied, reason = engine:apply('builder', {{position={0,0,0},nodeName='fixture:stone',param2=0}}, before, {status='PREPARED'})
assert(not denied and reason=='PERMISSION_DENIED' and writes==0, 'reenable cannot revive old prepared authority')
bound_ref = f.g:verify('builder').grantRef
local result = assert(engine:apply('builder', {{position={0,0,0},nodeName='fixture:stone',param2=0}}, before, {status='PREPARED'}))
assert(result.status=='APPLIED_PENDING_READBACK' and writes==1, 'current automatic proof reaches normal allowed effect')
-- Singleplayer is an engine fact, not a setting supplied by Shell.
saved = {}
local s = fixture('luanti:single', true)
s.toggle('singleplayer', true)
assert(s.g:mode().enabled, 'authenticated engine singleplayer owner can enable without server privilege')
s.toggle('singleplayer', false)
assert(not s.g:mode().enabled)
s.toggle('builder', true)
assert(not s.g:mode().enabled, 'singleplayer mode alone cannot make another name the owner')
local m = fixture('luanti:single', false)
m.toggle('singleplayer', true)
assert(not m.g:mode().enabled, 'multiplayer name singleplayer is not an owner')
print('automatic grant fixture PASS')
