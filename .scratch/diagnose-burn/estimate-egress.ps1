# Measure estimated host egress for a hosted Router (middle of Client<->Provider).
# RED = projected monthly egress exceeds free-tier allowance (default 5 GiB).
# Usage: pwsh .scratch/diagnose-burn/estimate-egress.ps1 [-ToolResultKb 1024] [-TurnsPerDay 400] [-FreeTierGb 5]

param(
  [int]$ToolResultKb = 1024,
  [int]$AssistantKb = 12,
  [int]$OverheadKb = 4,
  [int]$TurnsPerDay = 400,
  [double]$FreeTierGb = 5
)

# Bytes counted on host ≈ inbound+outbound each leg (Client↔Router and Router↔Provider)
$kbPerTurn = 2 * ($ToolResultKb + $OverheadKb) + 2 * ($AssistantKb + $OverheadKb)
$mbPerTurn = $kbPerTurn / 1024.0
$gbPerMonth = ($mbPerTurn * $TurnsPerDay * 30) / 1024.0
$red = $gbPerMonth -gt $FreeTierGb

Write-Host "tool_result_kb=$ToolResultKb assistant_kb=$AssistantKb turns_per_day=$TurnsPerDay"
Write-Host ("egress_MB_per_turn={0:N3}" -f $mbPerTurn)
Write-Host ("egress_GB_per_month={0:N2}" -f $gbPerMonth)
Write-Host ("free_tier_GB={0}" -f $FreeTierGb)
Write-Host ("VERDICT=$(if ($red) { 'RED' } else { 'GREEN' })")
if ($red) { exit 1 } else { exit 0 }
