function maximumAbsolute(values) {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}

export function rinneDesktopStabilityEvidence(step) {
  return {
    sourceNeckPoseMaximum: Math.max(
      maximumAbsolute(step.runtimeControls.neckRotation),
      maximumAbsolute(step.runtimeControls.neckTranslation),
    ),
    sourceType2Intensity: Math.abs(step.eyeControls.type2Intensity),
  };
}

export function stabilizeRinneDesktopStep(step, enabled = true) {
  if (!enabled) return step;
  return {
    ...step,
    eyeControls: {
      ...step.eyeControls,
      // The recovered type-2 helper strip is structurally proven but its
      // visible color role is not. In the selected Rinne packs it produces
      // transient hair/arm streaks, so the desktop-safe path keeps it hidden.
      type2Intensity: 0,
    },
    runtimeControls: {
      ...step.runtimeControls,
      // The legacy neck matrix transforms every submitted mesh in this
      // renderer. Zeroing it prevents expression changes from rocking the
      // character below the neck; expression, blink, breath, pupil and mouth
      // controls remain untouched.
      neckRotation: new Float32Array(3),
      neckTranslation: new Float32Array(3),
    },
  };
}
