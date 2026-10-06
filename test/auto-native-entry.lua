-- SOURCE/FIXTURE only: authenticated native callbacks are modelled here.
-- No chatcommand is executed; this does not prove a rendered game UI.
local function fixture(singleplayer)
  local storage, players, privs, forms, joins, callbacks, delayed = {}, {}, {}, {}, {}, {}, {}
  for _, name in ipairs({'manager', 'builder', 'visitor', 'singleplayer'}) do
    players[name] = {get_player_name=function() return name end}
    privs[name] = name == 'manager' and {server=true} or
      (name == 'builder' or name == 'singleplayer') and {interact=true,worldedit=true} or {}
  end
  local core = {
    get_mod_storage=function() return {
      get_string=function(_,k) return storage[k] or '' end,
      set_string=function(_,k,v) storage[k]=v end} end,
    get_player_by_name=function(name) return players[name] end,
    player_exists=function(name) return privs[name] ~= nil end,
    is_singleplayer=function() return singleplayer == true end,
    check_player_privs=function(who, required)
      local name=type(who)=='string' and who or who:get_player_name()
      for k in pairs(required) do if not (privs[name] or {})[k] then return false end end
      return true
    end,
    register_chatcommand=function() end,
    register_on_joinplayer=function(fn) joins[#joins+1]=fn end,
    register_on_player_receive_fields=function(fn) callbacks[#callbacks+1]=fn end,
    register_on_priv_revoke=function() end,
    after=function(_,fn) delayed[#delayed+1]=fn end,
    show_formspec=function(name,form,spec) forms[name]={form=form,spec=spec} end,
    formspec_escape=function(v) return v end,
    sha256=function(v) return v:gsub('\n', ':') end,
    get_us_time=function() return 1234 end,
  }
  local grant=dofile('payload/hanaworlds_adapter/grant.lua').new(core,'luanti:entry','Fixture world')
  local f={g=grant,players=players,privs=privs,forms=forms,storage=storage}
  function f.join(name)
    for _,fn in ipairs(joins) do fn(players[name],0) end
    local pending=delayed;delayed={};for _,fn in ipairs(pending) do fn() end
  end
  function f.fields(name,form,fields,player)
    for _,fn in ipairs(callbacks) do fn(player or players[name],form,fields) end
  end
  function f.open(name)
    f.fields(name,'hanaworlds:grant',{hw_auto_open=true})
  end
  return f
end
local f=fixture(false)
f.join('manager')
assert(f.forms.manager and f.forms.manager.form=='hanaworlds:grant',
  'native manager without build privileges must receive the existing world form on join')
assert(f.forms.manager.spec:find('hw_auto_open;Automatic authorization',1,true),
  'the manager must have a native no-command entry button')
assert(not f.g:mode().enabled and not f.g:verify('builder').current,
  'joining and displaying the entry cannot enable automatic authorization')
f.fields('manager','hanaworlds:auto',{hw_auto_enable=true})
assert(not f.g:mode().enabled,'unseen automatic panel still cannot enable')
f.fields('manager','hanaworlds:grant',{hw_auto_open=true,hw_auto_enable=true})
assert(f.forms.manager.form=='hanaworlds:auto' and not f.g:mode().enabled,
  'grant form opener only shows the existing panel, never toggles supplied fields')
assert(f.forms.manager.spec:find('hw_auto_enable',1,true))
f.fields('manager','hanaworlds:auto',{hw_auto_enable=true})
assert(f.g:mode().enabled and f.g:mode().enabledBy=='manager')
assert(f.g:verify('builder').current,'the unchanged automatic proof path is available')
f.privs.manager.interact=true;f.privs.manager.worldedit=true
f.join('manager')
assert(f.forms.manager.form=='hanaworlds:grant' and f.forms.manager.spec:find('hw_auto_open',1,true),
  'an already authorized manager can reenter without a command while automatic mode is enabled')
f.open('manager')
assert(f.forms.manager.form=='hanaworlds:auto' and f.forms.manager.spec:find('hw_auto_disable',1,true))
f.fields('manager','hanaworlds:auto',{hw_auto_disable=true})
assert(not f.g:mode().enabled,'native panel reaches the existing disable action')
f.join('builder')
assert(f.forms.builder.form=='hanaworlds:grant' and f.forms.builder.spec:find('hw_grant_confirm',1,true))
assert(not f.forms.builder.spec:find('hw_auto_open',1,true),'ordinary builder has no manager entry')
f.open('builder')
assert(f.forms.builder.form=='hanaworlds:grant' and not f.g:mode().enabled,
  'forged ordinary-player opener cannot enter the manager panel or enable mode')
f.join('manager')
f.privs.manager.server=nil
local before=f.forms.manager
f.open('manager')
assert(f.forms.manager==before and not f.g:mode().enabled,
  'authority lost between presentation and entry click is rejected')
f.privs.manager.server=true
f.join('manager');before=f.forms.manager
local previous=f.players.manager
f.players.manager={get_player_name=function() return 'manager' end}
f.fields('manager','hanaworlds:grant',{hw_auto_open=true},previous)
assert(f.forms.manager==before,'old PlayerRef cannot enter a replaced native session')
f.players.manager=nil
f.fields('manager','hanaworlds:grant',{hw_auto_open=true},previous)
assert(f.forms.manager==before,'offline manager cannot open')
local owner=fixture(true)
owner.join('singleplayer');owner.open('singleplayer')
assert(owner.forms.singleplayer.form=='hanaworlds:auto' and owner.forms.singleplayer.spec:find('hw_auto_enable',1,true),
  'actual engine singleplayer owner has the same native entry')
local named=fixture(false)
named.join('singleplayer')
assert(not named.forms.singleplayer.spec:find('hw_auto_open',1,true),
  'a multiplayer account named singleplayer is not an owner')
print('native automatic entry fixture PASS; GUI/product write gate NOT_RUN')
