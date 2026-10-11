local P=dofile('payload/hanaworlds_adapter/transport-policy.lua')
local key, kind, raw=arg[1],arg[2],arg[3]
local input={}
if kind~='absent' then
  local value=raw
  if kind=='number' then value=tonumber(raw) or (0/0)
  elseif kind=='boolean' then value=raw=='true'
  elseif kind=='object' then value={} end
  input[key]=value
end
print(P.validate(input)~=nil)
