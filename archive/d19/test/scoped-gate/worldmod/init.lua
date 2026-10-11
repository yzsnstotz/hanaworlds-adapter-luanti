-- This mod exists only in a newly created, isolated gate world. Commands are
-- accepted from a local file written by the gate runner, never from players.
local actor = 'hw_gate_tester'
local control = minetest.settings:get('hw_gate_control_dir')
assert(control and control ~= '', 'gate control directory required')

minetest.register_node('hw_scoped_gate:stone', {
  description = 'Scoped gate stone', tiles = {'unknown_node.png'},
})

minetest.register_on_joinplayer(function(player)
  if player:get_player_name() == actor then
    minetest.set_player_privs(actor, {interact = true, worldedit = true, shout = true})
  end
end)

local original_protection = minetest.is_protected
minetest.is_protected = function(pos, name)
  if name == actor and pos.x == 6 and pos.y == 1 and pos.z == 0 then return true end
  return original_protection(pos, name)
end

minetest.after(0, function()
  minetest.forceload_block({x = 0, y = 0, z = 0}, true)
  minetest.load_area({x = 0, y = 0, z = 0}, {x = 9, y = 2, z = 0})
  for _, x in ipairs({4, 5, 6, 7, 8, 9}) do
    minetest.set_node({x = x, y = 0, z = 0}, {name = 'hw_scoped_gate:stone'})
    minetest.set_node({x = x, y = 1, z = 0}, {name = 'air'})
  end
  minetest.log('action', 'HanaWorlds scoped gate world seeded')
  local fix_light = minetest.fix_light
  minetest.fix_light = function(first, last)
    local result = fix_light(first, last)
    minetest.log('action', 'HanaWorlds scoped gate fix_light ' .. tostring(result))
    return result
  end
  local get_node_light = minetest.get_node_light
  minetest.get_node_light = function(pos)
    local result = get_node_light(pos)
    minetest.log('action', 'HanaWorlds scoped gate node_light ' .. tostring(result))
    return result
  end
  for _, method in ipairs({'set', 'set_param2'}) do
    local method_name = method
    local original = worldedit[method]
    worldedit[method] = function(...)
      local count = original(...)
      minetest.log('action', 'HanaWorlds scoped gate worldedit.' .. method_name .. ' ' .. tostring(count))
      return count
    end
  end
end)

local last_sequence = nil
local function respond(sequence, action, outcome)
  local file = assert(io.open(control .. '/ack', 'w'))
  file:write(sequence .. ' ' .. action .. ' ' .. outcome .. '\n')
  file:close()
  minetest.log('action', 'HanaWorlds scoped gate admin ' .. sequence .. ' ' .. action .. ' ' .. outcome)
end

local function grant_action(player, action)
  -- Enter through the Adapter's registered game callback. This preserves its
  -- pending-form, privilege, grantRef and revocation logic under a real player.
  local command = assert(minetest.registered_chatcommands.hanaworlds_grant)
  assert(command.func(actor))
  local fields = action == 'grant' and {hw_grant_confirm = true}
    or {hw_grant_revoke = true}
  for _, callback in ipairs(minetest.registered_on_player_receive_fields) do
    callback(player, 'hanaworlds:grant', fields)
  end
end

local function process()
  local file = io.open(control .. '/command', 'r')
  if file then
    local line = file:read('*l')
    file:close()
    local sequence, action
    if line then sequence, action = line:match('^(%d+) ([a-z_]+)$') end
    if sequence and sequence ~= last_sequence then
      last_sequence = sequence
      local player = minetest.get_player_by_name(actor)
      if not player then
        respond(sequence, action, 'PLAYER_OFFLINE')
      elseif action == 'grant' or action == 'revoke' then
        local ok, error = pcall(grant_action, player, action)
        respond(sequence, action, ok and 'OK' or 'ERROR')
        if not ok then minetest.log('error', 'Gate admin callback: ' .. tostring(error)) end
      elseif action == 'drop_worldedit' or action == 'restore_worldedit' then
        local privs = minetest.get_player_privs(actor)
        privs.worldedit = action == 'restore_worldedit' or nil
        minetest.set_player_privs(actor, privs)
        respond(sequence, action, 'OK')
      elseif action == 'kick' then
        minetest.kick_player(actor, 'isolated gate offline check')
        respond(sequence, action, 'OK')
      elseif action == 'outside' or action == 'inside' then
        local x = action == 'outside' and 9 or 5
        local before = minetest.get_node({x = x, y = 1, z = 0}).name
        if before ~= 'air' then
          respond(sequence, action, 'PRESTATE_NOT_AIR')
        else
          minetest.set_node({x = x, y = 1, z = 0}, {name = 'hw_scoped_gate:stone'})
          local after = minetest.get_node({x = x, y = 1, z = 0}).name
          respond(sequence, action, before .. '_TO_' .. after)
        end
      elseif action == 'inspect_protected' then
        respond(sequence, action, minetest.get_node({x = 6, y = 1, z = 0}).name)
      elseif action == 'inspect_revoke' then
        respond(sequence, action, minetest.get_node({x = 7, y = 1, z = 0}).name)
      elseif action == 'inspect_new' then
        respond(sequence, action, minetest.get_node({x = 8, y = 1, z = 0}).name)
      else
        respond(sequence, action, 'UNKNOWN_ACTION')
      end
    end
  end
  minetest.after(0.1, process)
end
minetest.after(0.1, process)
