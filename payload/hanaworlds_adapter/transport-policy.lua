local M = {}
M.defaults = {courierResultWaitMs=30000,courierBodyBytes=4194304}
M.ranges = {courierResultWaitMs={1000,120000},courierBodyBytes={131072,4194304}}
M.envelopeReserveBytes = 65536
function M.validate(input)
  if input == nil then input = {} end
  if type(input) ~= 'table' then return nil, 'INVALID_CONFIG' end
  for k in pairs(input) do if M.defaults[k] == nil then return nil, 'INVALID_CONFIG' end end
  local out = {}
  for k, default in pairs(M.defaults) do
    local value = input[k]; if value == nil then value = default end
    local range = M.ranges[k]
    if type(value) ~= 'number' or value ~= value or value ~= math.floor(value)
      or value < range[1] or value > range[2] then return nil, 'INVALID_CONFIG' end
    out[k] = value
  end
  return out
end
function M.validate_paired(input)
  if type(input) ~= 'table' or input.courierBodyBytes == nil or input.courierResultWaitMs == nil then return nil, 'INVALID_CONFIG' end
  return M.validate(input)
end
return M
