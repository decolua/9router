export function isFreeProviderEnabled(settings, providerId) {
  return settings?.freeProviderStates?.[providerId] !== false;
}
