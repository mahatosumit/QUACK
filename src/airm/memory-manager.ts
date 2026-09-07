import type { MemoryState } from "./types.js";

export class MemoryManager {
  private state: MemoryState = {
    totalRAMGB: 32, freeRAMGB: 24, usedRAMGB: 8,
    totalVRAMGB: 16, freeVRAMGB: 14, usedVRAMGB: 2,
    swapUsedGB: 0.5, swapTotalGB: 16,
  };

  getState(): MemoryState {
    return { ...this.state };
  }

  canAllocateRAM(gb: number): boolean {
    return this.state.freeRAMGB >= gb;
  }

  canAllocateVRAM(gb: number): boolean {
    return this.state.freeVRAMGB >= gb;
  }

  allocateRAM(gb: number): boolean {
    if (!this.canAllocateRAM(gb)) return false;
    this.state.usedRAMGB += gb;
    this.state.freeRAMGB -= gb;
    return true;
  }

  allocateVRAM(gb: number): boolean {
    if (!this.canAllocateVRAM(gb)) return false;
    this.state.usedVRAMGB += gb;
    this.state.freeVRAMGB -= gb;
    return true;
  }

  releaseRAM(gb: number): void {
    this.state.usedRAMGB = Math.max(0, this.state.usedRAMGB - gb);
    this.state.freeRAMGB = Math.min(this.state.totalRAMGB, this.state.freeRAMGB + gb);
  }

  releaseVRAM(gb: number): void {
    this.state.usedVRAMGB = Math.max(0, this.state.usedVRAMGB - gb);
    this.state.freeVRAMGB = Math.min(this.state.totalVRAMGB, this.state.freeVRAMGB + gb);
  }

  getUtilization(): { ram: number; vram: number; swap: number } {
    return {
      ram: Math.round((this.state.usedRAMGB / this.state.totalRAMGB) * 100),
      vram: Math.round((this.state.usedVRAMGB / this.state.totalVRAMGB) * 100),
      swap: this.state.swapTotalGB > 0 ? Math.round((this.state.swapUsedGB / this.state.swapTotalGB) * 100) : 0,
    };
  }

  optimizeForModel(requiredRAMGB: number, requiredVRAMGB: number): { canFit: boolean; needsRAMRelease: number; needsVRAMRelease: number; recommendations: string[] } {
    const recs: string[] = [];
    const ramShortfall = Math.max(0, requiredRAMGB - this.state.freeRAMGB);
    const vramShortfall = Math.max(0, requiredVRAMGB - this.state.freeVRAMGB);
    if (ramShortfall > 0) recs.push(`Release ${ramShortfall.toFixed(1)}GB RAM by unloading models`);
    if (vramShortfall > 0) recs.push(`Release ${vramShortfall.toFixed(1)}GB VRAM by unloading GPU models`);
    if (ramShortfall > this.state.usedRAMGB * 0.8) recs.push("Consider adding more RAM");
    if (vramShortfall > this.state.usedVRAMGB * 0.8) recs.push("Consider using CPU offloading or smaller quantizations");
    return { canFit: ramShortfall === 0 && vramShortfall === 0, needsRAMRelease: ramShortfall, needsVRAMRelease: vramShortfall, recommendations: recs };
  }

  refresh(): void {
    this.state.freeRAMGB = this.state.totalRAMGB - this.state.usedRAMGB;
    this.state.freeVRAMGB = this.state.totalVRAMGB - this.state.usedVRAMGB;
  }
}
