/**
 * Get consistent machine ID using node-machine-id with salt
 * This ensures the same physical machine gets the same ID across runs
 * 
 * @param {string} salt - Optional salt to use (defaults to environment variable)
 */
export async function getConsistentMachineId(salt: string | null = null): Promise<string> {
  // If in browser, fallback to a random ID
  if (typeof window !== 'undefined') {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // For server-side, use node-machine-id with salt
  const saltValue = salt || process.env.MACHINE_ID_SALT || 'endpoint-proxy-salt';
  try {
    const { machineIdSync } = await import('node-machine-id');
    const rawMachineId = machineIdSync();
    // Create consistent ID using salt
    const crypto = await import('crypto');
    const hashedMachineId = crypto.createHash('sha256').update(rawMachineId + saltValue).digest('hex');
    // Return only first 16 characters for brevity
    return hashedMachineId.substring(0, 16);
  } catch (error) {
    console.log('Error getting machine ID:', error);
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

/**
 * Get raw machine ID without hashing (for debugging purposes)
 */
export async function getRawMachineId(): Promise<string> {
  if (typeof window !== 'undefined') return 'browser';
  
  // For server-side, use raw node-machine-id
  try {
    const { machineIdSync } = await import('node-machine-id');
    return machineIdSync();
  } catch (error) {
    console.log('Error getting raw machine ID:', error);
    return 'error-fetching-id';
  }
}

/**
 * Check if we're running in browser or server environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}
