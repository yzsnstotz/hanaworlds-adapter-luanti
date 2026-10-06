-- World-local native delegation. The only mode writer is the engine's
-- authenticated receive-fields callback; courier callers can only read it.
local M = {}
local SCOPE = 'WORLD_BUILD_WITH_ENGINE_PROTECTION'
local FORM = 'hanaworlds:grant'
local AUTO_FORM = 'hanaworlds:auto'

function M.new(core, world_ref, world_name)
  local storage = core.get_mod_storage()
  local pending = {}
  local pending_auto = {}
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
    storage:set_string('auto-player:' .. name, '')
    pending[name] = nil
  end

  local function can_manage(name)
    -- An offline enabler still has a native account and current engine
    -- authority. No file ownership, caller JSON or Shell identity is used.
    if type(core.player_exists) ~= 'function' or not core.player_exists(name) then return false end
    if core.check_player_privs(name, {server = true}) == true then return true end
    return type(core.is_singleplayer) == 'function' and core.is_singleplayer() == true
      and name == 'singleplayer'
  end
  local function fresh_ref(name)
    local sequence = (tonumber(storage:get_string('grant-sequence')) or 0) + 1
    storage:set_string('grant-sequence', tostring(sequence))
    local ref = core.sha256(world_ref .. '\n' .. name .. '\n' .. tostring(sequence)
      .. '\n' .. tostring(core.get_us_time()))
    return ref
  end
  function self:mode()
    local world, name, ref = storage:get_string('world-auto'):match('^v1\n([^\n]+)\n([^\n]+)\n([^\n]+)$')
    if world == world_ref and name and can_manage(name) then
      return {worldRef = world_ref, enabled = true, enabledBy = name,
        modeRef = ref, scope = SCOPE}
    end
    if world == world_ref then storage:set_string('world-auto', '') end
    return {worldRef = world_ref, enabled = false, scope = SCOPE}
  end

  function self:verify(name)
    local player = online_player(name)
    if not player then return {current = false} end
    if not can_build(player) then
      invalidate(name)
      return {current = false}
    end
    local mode = self:mode()
    local ref
    if mode.enabled then
      local epoch, saved_ref = storage:get_string('auto-player:' .. name):match('^([^\n]+)\n([^\n]+)$')
      if epoch == mode.modeRef then ref = saved_ref end
      if not ref then
        ref = fresh_ref('auto-player:' .. name)
        storage:set_string('auto-player:' .. name, mode.modeRef .. '\n' .. ref)
      end
    else ref = stored(name) end
    if not ref then return {current = false} end
    return {current = true, worldRef = world_ref, engineActorName = name,
      scope = SCOPE, grantRef = ref}
  end

  function self:list_current()
    if type(core.get_connected_players) ~= 'function' then
      return nil, 'CAPABILITY_UNAVAILABLE'
    end
    local players = core.get_connected_players()
    if type(players) ~= 'table' then return nil, 'CAPABILITY_UNAVAILABLE' end
    local out = {}
    for _, player in ipairs(players) do
      local proof = self:verify(player:get_player_name())
      if proof.current then out[#out + 1] = proof end
    end
    table.sort(out, function(a, b) return a.engineActorName < b.engineActorName end)
    return out
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
    if self:mode().enabled then
      pending[name] = nil
      spec = spec .. 'label[0.5,5.7;World automatic authorization is enabled.]'
    elseif has_grant then
      spec = spec .. 'button_exit[0.5,6;4,0.8;hw_grant_revoke;Revoke authorization]'
    elseif can_build(online_player(name)) then
      spec = spec .. 'button_exit[0.5,6;4,0.8;hw_grant_confirm;Authorize this world]'
    end
    if can_manage(name) then
      spec = spec .. 'button[5,6;4.5,0.8;hw_auto_open;Automatic authorization]'
    end
    core.show_formspec(name, FORM, spec)
  end

  local function show_auto(name)
    local mode = self:mode()
    local escape = core.formspec_escape
    local spec = 'formspec_version[4]size[10,6]'
      .. 'label[0.5,0.5;HanaWorlds automatic world authorization]'
      .. 'label[0.5,1.1;World: ' .. escape(world_name) .. ']'
      .. 'label[0.5,1.7;' .. escape(world_ref) .. ']'
      .. 'label[0.5,2.3;Status: ' .. (mode.enabled and 'Enabled' or 'Disabled') .. ']'
      .. 'label[0.5,2.9;Online builders only; every write checks privileges.]'
      .. 'label[0.5,3.5;Exact target scope and per-cell protection still apply.]'
    pending_auto[name] = nil
    if can_manage(name) then
      pending_auto[name] = {action = mode.enabled and 'disable' or 'enable',
        epoch = mode.modeRef or 'disabled'}
      spec = spec .. (mode.enabled
        and 'button_exit[0.5,4.7;5,0.8;hw_auto_disable;Disable automatic authorization]'
        or 'button_exit[0.5,4.7;5,0.8;hw_auto_enable;Enable automatic authorization]')
    else spec = spec .. 'label[0.5,4.7;Only a native administrator or world owner can change this.]' end
    core.show_formspec(name, AUTO_FORM, spec)
  end

  core.register_on_joinplayer(function(player, last_login)
    local name = player:get_player_name()
    -- Luanti documents nil last_login for a newly created account. A deleted
    -- account recreated under the same name must not inherit its old grant.
    if last_login == nil then
      invalidate(name)
      local mode = self:mode()
      if mode.enabledBy == name then storage:set_string('world-auto', '') end
    end
    pending_auto[name] = nil
    -- Run after every mod's join callback so newly granted engine privileges
    -- are observed before offering the player's first confirmation.
    core.after(0, function()
      local current = online_player(name)
      if current and (can_manage(name)
        or (can_build(current) and not self:verify(name).current)) then show(name) end
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
  core.register_chatcommand('hanaworlds_auto', {
    description = 'View automatic authorization; native admins/world owner can toggle it',
    func = function(name)
      if not online_player(name) then return false, 'Player is unavailable' end
      show_auto(name)
      return true, ''
    end,
  })
  core.register_on_player_receive_fields(function(player, formname, fields)
    if (formname ~= FORM and formname ~= AUTO_FORM) or not player then return end
    local name = player:get_player_name()
    if online_player(name) ~= player then return end
    if formname == FORM and fields.hw_auto_open then
      pending[name] = nil
      if can_manage(name) then show_auto(name) end
      return
    end
    if formname == AUTO_FORM then
      local expected = pending_auto[name]
      pending_auto[name] = nil
      local mode = self:mode()
      if not expected or not can_manage(name)
        or expected.epoch ~= (mode.modeRef or 'disabled') then return end
      if expected.action == 'enable' and fields.hw_auto_enable and not fields.hw_auto_disable then
        storage:set_string('world-auto', table.concat({'v1', world_ref, name,
          fresh_ref('auto-mode:' .. name)}, '\n'))
        pending = {}
        show_auto(name)
      elseif expected.action == 'disable' and fields.hw_auto_disable and not fields.hw_auto_enable then
        storage:set_string('world-auto', '')
        pending = {}
        show_auto(name)
      end
      return
    end
    local expected = pending[name]
    pending[name] = nil
    if self:mode().enabled then return end
    if expected == 'confirm' and fields.hw_grant_confirm and can_build(player) then
      local ref = fresh_ref(name)
      storage:set_string(key(name), table.concat({'v1', world_ref, SCOPE, ref}, '\n'))
      show(name)
    elseif expected == 'revoke' and fields.hw_grant_revoke then
      invalidate(name)
      show(name)
    end
  end)
  core.register_on_priv_revoke(function(name, _, priv)
    if priv == 'interact' or priv == 'worldedit' then invalidate(name) end
    if priv == 'server' then self:mode() end
  end)
  return self
end

return M
