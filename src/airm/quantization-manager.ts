import type { Quantization, ModelInfo, GpuInfo } from "./types.js";

export interface QuantizationRecommendation {
  quantization: Quantization;
  estimatedVRAMGB: number;
  estimatedRAMGB: number;
  quality: number;
  speed: number;
  compatible: boolean;
}

export class QuantizationManager {
  getSupportedQuantizations(): Quantization[] {
    return ["fp16", "bf16", "int8", "int4", "gguf_q2", "gguf_q3", "gguf_q4", "gguf_q5", "gguf_q6", "gguf_q8", "gptq", "awq", "exl2", "none"];
  }

  getQuantizationSize(modelParams: number, quantization: Quantization): number {
    const bytesPerParam: Record<string, number> = {
      fp16: 2, bf16: 2, int8: 1, int4: 0.5,
      gguf_q2: 0.25, gguf_q3: 0.375, gguf_q4: 0.5, gguf_q5: 0.625, gguf_q6: 0.75, gguf_q8: 1,
      gptq: 0.5, awq: 0.5, exl2: 0.5, none: 2,
    };
    return (bytesPerParam[quantization] ?? 2) * modelParams;
  }

  recommendQuantization(model: ModelInfo, gpus: GpuInfo[], availableRAMGB: number): QuantizationRecommendation[] {
    const recommendations: QuantizationRecommendation[] = [];
    const totalVRAMGB = gpus.reduce((s, g) => s + g.totalVRAMMB, 0) / 1024;
    const freeVRAMGB = gpus.reduce((s, g) => s + g.freeVRAMMB, 0) / 1024;
    for (const quant of this.getSupportedQuantizations()) {
      const sizeGB = this.getQuantizationSize(model.parameters, quant);
      const compatibleVram = freeVRAMGB >= sizeGB * 1.2;
      const compatibleRam = availableRAMGB >= sizeGB * 1.5;
      const quality = this.getQualityScore(quant);
      const speed = this.getSpeedScore(quant, gpus.length > 0);
      recommendations.push({
        quantization: quant, estimatedVRAMGB: Math.round(sizeGB * 1.2 * 10) / 10,
        estimatedRAMGB: Math.round(sizeGB * 1.3 * 10) / 10,
        quality, speed, compatible: compatibleVram || compatibleRam,
      });
    }
    return recommendations.sort((a, b) => (b.compatible ? 1 : 0) - (a.compatible ? 1 : 0) || b.quality - a.quality);
  }

  getBestQuantization(model: ModelInfo, gpus: GpuInfo[], availableRAMGB: number): QuantizationRecommendation | null {
    const recs = this.recommendQuantization(model, gpus, availableRAMGB);
    const compatible = recs.filter((r) => r.compatible);
    return compatible.length > 0 ? compatible[0]! : null;
  }

  getQualityScore(quant: Quantization): number {
    const scores: Record<string, number> = {
      fp16: 100, bf16: 99, int8: 90, int4: 75,
      gguf_q8: 88, gguf_q6: 82, gguf_q5: 78, gguf_q4: 72, gguf_q3: 60, gguf_q2: 45,
      gptq: 76, awq: 74, exl2: 73, none: 0,
    };
    return scores[quant] ?? 50;
  }

  getSpeedScore(quant: Quantization, hasGpu: boolean): number {
    if (hasGpu) {
      const scores: Record<string, number> = {
        fp16: 90, bf16: 88, int8: 95, int4: 98,
        gguf_q8: 85, gguf_q6: 88, gguf_q5: 90, gguf_q4: 93, gguf_q3: 95, gguf_q2: 97,
        gptq: 92, awq: 94, exl2: 91, none: 0,
      };
      return scores[quant] ?? 80;
    }
    const scores: Record<string, number> = {
      fp16: 30, bf16: 30, int8: 60, int4: 80,
      gguf_q8: 55, gguf_q6: 65, gguf_q5: 70, gguf_q4: 80, gguf_q3: 85, gguf_q2: 92,
      gptq: 40, awq: 40, exl2: 35, none: 0,
    };
    return scores[quant] ?? 50;
  }

  getStats(): { totalSupported: number; byQuality: Record<string, number>; bySpeed: Record<string, number> } {
    const byQuality: Record<string, number> = {};
    const bySpeed: Record<string, number> = {};
    for (const q of this.getSupportedQuantizations()) {
      byQuality[q] = this.getQualityScore(q);
      bySpeed[q] = this.getSpeedScore(q, true);
    }
    return { totalSupported: this.getSupportedQuantizations().length, byQuality, bySpeed };
  }
}
