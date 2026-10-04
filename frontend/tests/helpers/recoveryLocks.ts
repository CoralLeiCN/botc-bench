import type { RecoveryLocks } from "../../src/recovery.ts";

/** Shared browser lock manager for independent tab/window test contexts. */
export class TestRecoveryLocks implements RecoveryLocks {
  private held = new Set<string>();

  async request(name: string, _options: { ifAvailable: true }, callback: (lock: object | null) => Promise<void>): Promise<void> {
    if (this.held.has(name)) { await callback(null); return; }
    this.held.add(name);
    try { await callback({ name }); }
    finally { this.held.delete(name); }
  }
}
