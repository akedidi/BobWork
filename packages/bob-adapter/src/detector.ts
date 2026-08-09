export async function detectBob(): Promise<{ installed: boolean; version?: string }> {
  // Since we are running in the frontend/renderer via Tauri, actual detection
  // is performed by the Rust backend. This frontend stub is for type definition.
  // In a real scenario, we'd invoke the Tauri command 'detect_bob'.
  return { installed: false };
}
