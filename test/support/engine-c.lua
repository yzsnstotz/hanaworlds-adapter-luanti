-- FIXTURE: pure-Lua stand-ins for engine (C) functions. A marked function reports
-- debug.getinfo(fn).what == 'C' as the real engine function does; nothing else changes.
if _G.__hw_engine_c then return _G.__hw_engine_c end
local marked = setmetatable({}, {__mode = 'k'})
local getinfo = debug.getinfo
debug.getinfo = function(fn, ...)
  local info = getinfo(fn, ...)
  if type(fn) == 'function' and marked[fn] and type(info) == 'table' then info.what = 'C' end
  return info
end
_G.__hw_engine_c = function(fn) marked[fn] = true; return fn end
return _G.__hw_engine_c
