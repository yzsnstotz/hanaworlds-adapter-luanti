local commands, callbacks, revocations, joins, scheduled, forms = {}, {}, {}, {}, {}, {}
local saved = {}
local online = true
local privileges = {interact = true, worldedit = true}
local player = {get_player_name = function() return 'alice' end}
local storage = {
  get_string = function(_, key) return saved[key] or '' end,
  set_string = function(_, key, value) saved[key] = value end,
}
local core = {
  get_mod_storage = function() return storage end,
  get_player_by_name = function(name) return online and name == 'alice' and player or nil end,
  get_connected_players = function() return online and {player} or {} end,
  check_player_privs = function(who, required)
    assert(who == player, 'privileges must be checked against the native player object')
    for key in pairs(required) do if not privileges[key] then return false end end
    return true
  end,
  register_chatcommand = function(name, spec) commands[name] = spec end,
  register_on_player_receive_fields = function(fn) callbacks[#callbacks + 1] = fn end,
  register_on_priv_revoke = function(fn) revocations[#revocations + 1] = fn end,
  register_on_joinplayer = function(fn) joins[#joins + 1] = fn end,
  after = function(_, fn) scheduled[#scheduled + 1] = fn end,
  show_formspec = function(name, form, spec) forms[#forms + 1] = {name, form, spec} end,
  formspec_escape = function(value) return value end,
  sha256 = function(value) return value:gsub('\n', ':') end,
  get_us_time = function() return 123456 end,
}
local grants = dofile('payload/hanaworlds_adapter/grant.lua').new(core,
  'luanti:world-one', 'Test World')

assert(not grants:verify('alice').current, 'unconfirmed player is denied')
callbacks[1](player, 'hanaworlds:grant', {hw_grant_confirm = true})
assert(not grants:verify('alice').current, 'an unseen form cannot grant')
assert(joins[1], 'the engine join path opens first authorization')
joins[1](player)
table.remove(scheduled, 1)()
assert(forms[#forms][2] == 'hanaworlds:grant', 'first unconfirmed join opens native form')
callbacks[1](player, 'hanaworlds:grant', {hw_grant_confirm = true})
assert(grants:verify('alice').current, 'only authenticated in-game confirmation grants')
callbacks[1](player, 'hanaworlds:grant', {hw_grant_revoke = true})
assert(not grants:verify('alice').current, 'native revoke closes the grant')
assert(commands.hanaworlds_grant.func('alice'))
assert(forms[#forms][3]:find('Test World', 1, true))
assert(forms[#forms][3]:find('World identity: luanti:', 1, true)
  and forms[#forms][3]:find('world-one', 1, true))
assert(forms[#forms][3]:find('all locations', 1, true))
callbacks[1](player, 'hanaworlds:grant', {hw_grant_confirm = true})
local first = grants:verify('alice')
assert(first.current and first.worldRef == 'luanti:world-one'
  and first.engineActorName == 'alice' and first.scope == 'WORLD_BUILD_WITH_ENGINE_PROTECTION'
  and type(first.grantRef) == 'string', 'grant is bound to native player, world and scope')
assert(#grants:list_current() == 1 and grants:list_current()[1].grantRef == first.grantRef,
  'native list includes only current online and permitted confirmation')
assert(saved['player:alice'] ~= nil, 'grant persists in world mod storage')
assert(commands.hanaworlds_grant.func('alice'))
assert(forms[#forms][3]:find('Authorized', 1, true), 'status is visible in game')
callbacks[1](player, 'hanaworlds:grant', {hw_grant_revoke = true})
assert(not grants:verify('alice').current, 'revoke denies new commands immediately')
assert(#grants:list_current() == 0, 'revocation removes the native list candidate')
assert(commands.hanaworlds_grant.func('alice'))
callbacks[1](player, 'hanaworlds:grant', {hw_grant_confirm = true})
local second = grants:verify('alice')
assert(second.current and second.grantRef ~= first.grantRef,
  'a new confirmation never resurrects an old proof')
joins[1](player, 123)
table.remove(scheduled, 1)()
assert(grants:verify('alice').current, 'same authenticated account retains its grant')
joins[1](player, nil)
assert(not grants:verify('alice').current,
  'a new account under the same name cannot inherit the old account grant')
table.remove(scheduled, 1)()
assert(forms[#forms][3]:find('Not authorized', 1, true),
  'new account must see a new confirmation form')
callbacks[1](player, 'hanaworlds:grant', {hw_grant_confirm = true})
assert(grants:verify('alice').current, 'new account can make its own confirmation')
revocations[1]('alice', 'operator', 'worldedit')
assert(not grants:verify('alice').current, 'privilege revocation invalidates grant')
assert(commands.hanaworlds_grant.func('alice'))
callbacks[1](player, 'hanaworlds:grant', {hw_grant_confirm = true})
assert(grants:verify('alice').current)
privileges.worldedit = false
assert(not grants:verify('alice').current, 'current engine privileges are required')
assert(#grants:list_current() == 0, 'privilege loss removes the list candidate')
privileges.worldedit = true
assert(not grants:verify('alice').current, 'privilege restoration cannot reuse an invalidated grant')
assert(not dofile('payload/hanaworlds_adapter/grant.lua').new(core,
  'luanti:world-two', 'Other World'):verify('alice').current,
  'a stored grant is never valid in another world')
online = false
assert(not grants:verify('alice').current, 'offline player is denied')
assert(not commands.hanaworlds_grant.func('alice'), 'offline name cannot open form')
core.get_connected_players = nil
local missing, reason = grants:list_current()
assert(missing == nil and reason == 'CAPABILITY_UNAVAILABLE',
  'missing native player enumeration is a capability failure, not an empty grant list')
print('grant fixture PASS')
