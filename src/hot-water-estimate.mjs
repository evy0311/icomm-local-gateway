// Experimental, gateway-defined heuristic. Not the manufacturer's status algorithm.
// One user observation (three bars) supports only the initial baseline, not transitions.
export function estimateHotWater(raw, setpointF, mode) {
  const result = { bars: null, level: null, provisional: true, confidence: 'low',
    method: 'temperature-deficit-v1', source: 'segment 2, byte offset 2 (unverified temperature-like word)',
    thresholds_deficit_f: { three_bars_max: 15, two_bars_max: 30 },
    candidate_raw: raw ?? null, candidate_fahrenheit: null, deficit_fahrenheit: null };
  if (mode !== 'STANDARD') return { ...result, reason: 'Not estimated outside Standard mode' };
  const candidateF = raw / 256 * 9 / 5 + 32;
  if (!Number.isInteger(raw) || raw <= 0 || raw >= 65535 || candidateF < 40 || candidateF > 180 ||
      !Number.isFinite(setpointF) || setpointF < 95 || setpointF > 130) {
    return { ...result, reason: 'Missing or implausible input' };
  }
  const deficit = setpointF - candidateF;
  const bars = deficit <= 15 ? 3 : deficit <= 30 ? 2 : 1;
  return { ...result, bars, level: ['Low', 'Medium', 'High'][bars - 1],
    candidate_fahrenheit: Number(candidateF.toFixed(1)), deficit_fahrenheit: Number(deficit.toFixed(1)),
    reason: 'Assumed thresholds; validate against the official app during normal use' };
}
