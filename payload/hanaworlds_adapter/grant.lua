-- World-local, player-confirmed delegation. The only writer is the engine's
-- authenticated receive-fields callback; courier callers can only read it.
local M = {}
local SCOPE = 'WORLD_BUILD_WITH_ENGINE_PROTECTION'
local FORM = 'hanaworlds:grant'

function M.new(core, world_ref, world_name)
  local storage = core.get_mod_storage()
  local pending = {}
  local self = {}
  local function key(name) return 'player:' .. name end
  local function online_player(name)
    if type(name) ~= 'string' or name == '' then return nil end
    local player = core.get_player_by_name(name)
    if not player or player:get_player_name() ~= name then return nil end
    return player
  end
  local function can_build(player)
    return core.check_player_privs(player, {interact = true, worldedit = true}) == true
  end
  local function stored(name)
    local raw = storage:get_string(key(name))
    local ref = raw:match('^v1\n' .. world_ref:gsub('([^%w])', '%%%1') .. '\n'
      .. SCOPE .. '\n([^\n]+)$')
    return ref
  end
  local function invalidate(name)
    storage:set_string(key(name), '')
    pending[name] = nil
  end

  function self:verify(name)
    local player = online_player(name)
    if not player then return {current = false} end
    if not can_build(player) then
      invalidate(name)
      return {current = false}
    end
    local ref = stored(name)
    if not ref then return {current = false} end
    return {current = true, worldRef = world_ref, engineActorName = name,
      scope = SCOPE, grantRef = ref}
  end

  local function show(name)
    local proof = self:verify(name)
    local has_grant = proof.current
    pending[name] = has_grant and 'revoke' or 'confirm'
    local escape = core.formspec_escape
    local scheme, identifier = world_ref:match('^([^:]+:)(.+)$')
    local spec = 'formspec_version[4]size[10,7]'
      .. 'label[0.5,0.5;HanaWorlds world authorization]'
      .. 'label[0.5,1.1;World: ' .. escape(world_name) .. ']'
      .. 'label[0.5,1.6;World identity: ' .. escape(scheme or '') .. ']'
      .. 'label[0.5,2.1;' .. escape(identifier or world_ref) .. ']'
      .. 'label[0.5,2.8;Scope: all locations this player may build in.]'
      .. 'label[0.5,3.4;Every write checks online status and build privileges.]'
      .. 'label[0.5,4.0;Target protection is checked for each affected cell.]'
      .. 'label[0.5,4.6;Delegated to the local HanaWorlds account.]'
      .. 'label[0.5,5.2;Status: ' .. (has_grant and 'Authorized' or 'Not authorized') .. ']'
    if has_grant then
      spec = spec .. 'button_exit[0.5,6;4,0.8;hw_grant_revoke;Revoke authorization]'
    elseif can_build(online_player(name)) then
      spec = spec .. 'button_exit[0.5,6;4,0.8;hw_grant_confirm;Authorize this world]'
    end
    core.show_formspec(name, FORM, spec)
  end

  core.register_on_joinplayer(function(player, last_login)
    local name = player:get_player_name()
    -- Luanti documents nil last_login for a newly created account. A deleted
    -- account recreated under the same name must not inherit its old grant.
    if last_login == nil then invalidate(name) end
    -- Run after every mod's join callback so newly granted engine privileges
    -- are observed before offering the player's first confirmation.
    core.after(0, function()
      local current = online_player(name)
      if current and can_build(current) and not self:verify(name).current then show(name) end
    end)
  end)

  core.register_chatcommand('hanaworlds_grant', {
    description = 'View or change HanaWorlds authorization for this world',
    func = function(name)
      if not online_player(name) then return false, 'Player is unavailable' end
      show(name)
      return true, ''
    end,
  })
  core.register_on_player_receive_fields(function(player, formname, fields)
    if formname ~= FORM or not player then return end
    local name = player:get_player_name()
    if online_player(name) ~= player then return end
    local expected = pending[name]
    pending[name] = nil
    if expected == 'confirm' and fields.hw_grant_confirm and can_build(player) then
      local sequence = (tonumber(storage:get_string('grant-sequence')) or 0) + 1
      local ref = core.sha256(world_ref .. '\n' .. name .. '\n' .. tostring(sequence)
        .. '\n' .. tostring(core.get_us_time()))
      storage:set_string('grant-sequence', tostring(sequence))
      storage:set_string(key(name), table.concat({'v1', world_ref, SCOPE, ref}, '\n'))
      show(name)
    elseif expected == 'revoke' and fields.hw_grant_revoke then
      invalidate(name)
      show(name)
    end
  end)
  core.register_on_priv_revoke(function(name, _, priv)
    if priv == 'interact' or priv == 'worldedit' then invalidate(name) end
  end)
  return self
end

return M
