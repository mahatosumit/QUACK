import type { ComputerProvider, Screenshot, OcrResult, DetectedRegion, Rect, UiElement, UiElementType } from "./types.js";

export interface LayoutRegion {
  type: "text_block" | "image" | "button" | "input" | "list" | "table" | "navigation" | "header" | "footer" | "sidebar";
  bounds: Rect;
  confidence: number;
  children: LayoutRegion[];
}

export interface ScreenDescription {
  title: string;
  regions: LayoutRegion[];
  textContent: string;
  interactiveElements: number;
  dialogs: number;
  focusedElement?: { type: string; label: string };
  summary: string;
}

export class VisionRuntime {
  private provider: ComputerProvider;

  constructor(provider: ComputerProvider) {
    this.provider = provider;
  }

  async performOcr(screenshot: Screenshot, bounds?: Rect): Promise<OcrResult> {
    return this.provider.ocrImage(screenshot, bounds);
  }

  async detectElements(screenshot: Screenshot, types?: UiElementType[]): Promise<DetectedRegion[]> {
    return this.provider.detectElements(screenshot, types);
  }

  async getUiTree(windowId?: string): Promise<UiElement> {
    return this.provider.getUiTree(windowId);
  }

  async describeScreen(screenshot: Screenshot): Promise<ScreenDescription> {
    const ocrResult = await this.performOcr(screenshot);
    const uiTree = await this.provider.getUiTree();
    const elements = await this.detectElements(screenshot);

    const layout = this.analyzeLayout(ocrResult, uiTree);
    const interactiveElements = this.countInteractive(uiTree);

    const focusedEl = this.findFocused(uiTree);

    return {
      title: uiTree.label || "Desktop",
      regions: layout,
      textContent: ocrResult.fullText,
      interactiveElements,
      dialogs: this.countDialogs(uiTree),
      focusedElement: focusedEl ? { type: focusedEl.type, label: focusedEl.label } : undefined,
      summary: this.generateSummary(ocrResult, uiTree, elements),
    };
  }

  async findElementByText(text: string, screenshot: Screenshot): Promise<{ element: DetectedRegion | null; ocr: OcrResult }> {
    const ocr = await this.performOcr(screenshot);
    const lowerText = text.toLowerCase();

    for (const region of ocr.regions) {
      if (region.text.toLowerCase().includes(lowerText)) {
        return { element: { bounds: region.bounds, type: "text", label: region.text, confidence: region.confidence, text: region.text }, ocr };
      }
    }

    const elements = await this.detectElements(screenshot);
    for (const el of elements) {
      if (el.text.toLowerCase().includes(lowerText) || el.label.toLowerCase().includes(lowerText)) {
        return { element: el, ocr };
      }
    }

    return { element: null, ocr };
  }

  async findElementByType(type: UiElementType, screenshot: Screenshot): Promise<DetectedRegion[]> {
    return this.detectElements(screenshot, [type]);
  }

  private analyzeLayout(ocr: OcrResult, uiTree: UiElement): LayoutRegion[] {
    const regions: LayoutRegion[] = [];

    if (ocr.regions.length > 0) {
      regions.push({
        type: "text_block",
        bounds: this.mergeBounds(ocr.regions.map((r) => r.bounds)),
        confidence: ocr.regions.reduce((sum, r) => sum + r.confidence, 0) / ocr.regions.length,
        children: ocr.regions.map((r) => ({
          type: "text_block", bounds: r.bounds, confidence: r.confidence, children: [],
        })),
      });
    }

    for (const child of uiTree.children) {
      const childRegion = this.uiElementToLayout(child);
      if (childRegion) regions.push(childRegion);
    }

    return regions;
  }

  private uiElementToLayout(element: UiElement): LayoutRegion | null {
    const typeMap: Partial<Record<UiElementType, LayoutRegion["type"]>> = {
      button: "button", text_field: "input", textarea: "input",
      list: "list", table: "table", toolbar: "navigation",
      menu: "navigation", editor: "input",
    };
    const layoutType = typeMap[element.type] ?? "text_block";

    return {
      type: layoutType,
      bounds: element.bounds,
      confidence: element.confidence,
      children: element.children.map((c) => this.uiElementToLayout(c)).filter((r): r is LayoutRegion => r !== null),
    };
  }

  private countInteractive(element: UiElement): number {
    const interactive: UiElementType[] = ["button", "text_field", "checkbox", "radio", "dropdown", "slider", "switch", "link", "menu_item", "tab"];
    let count = interactive.includes(element.type) ? 1 : 0;
    for (const child of element.children) count += this.countInteractive(child);
    return count;
  }

  private countDialogs(element: UiElement): number {
    let count = element.type === "dialog" ? 1 : 0;
    for (const child of element.children) count += this.countDialogs(child);
    return count;
  }

  private findFocused(element: UiElement): UiElement | null {
    if (element.focused) return element;
    for (const child of element.children) {
      const found = this.findFocused(child);
      if (found) return found;
    }
    return null;
  }

  private mergeBounds(boundsList: Rect[]): Rect {
    if (boundsList.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    const minX = Math.min(...boundsList.map((b) => b.x));
    const minY = Math.min(...boundsList.map((b) => b.y));
    const maxX = Math.max(...boundsList.map((b) => b.x + b.width));
    const maxY = Math.max(...boundsList.map((b) => b.y + b.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private generateSummary(ocr: OcrResult, uiTree: UiElement, elements: DetectedRegion[]): string {
    const parts: string[] = [];
    if (ocr.fullText) parts.push(`Screen contains text: ${ocr.fullText.slice(0, 200)}`);
    const interactive = this.countInteractive(uiTree);
    if (interactive > 0) parts.push(`${interactive} interactive elements detected`);
    if (elements.length > 0) parts.push(`${elements.length} UI regions identified`);
    return parts.join(". ") || "Empty desktop";
  }
}
