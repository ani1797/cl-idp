const PERCENT_SCALE = 100;

export function confidenceThresholdFloatToPercent(value: number) {
  return Math.round(value * PERCENT_SCALE * 100) / 100;
}

export function confidenceThresholdPercentToFloat(value: number) {
  return Math.round((value / PERCENT_SCALE) * 10_000) / 10_000;
}
