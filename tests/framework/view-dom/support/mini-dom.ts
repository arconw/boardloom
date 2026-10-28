type Listener = (event: MiniEvent) => void;

export interface MiniEvent {
  readonly type: string;
  target?: MiniElement | null;
  defaultPrevented?: boolean;
}

class MiniStyle {
  private readonly values = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeProperty(name: string): void {
    this.values.delete(name);
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? "";
  }
}

export class MiniElement {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly ownerDocument: MiniDocument;
  parentNode: MiniElement | null = null;
  childNodes: Array<MiniElement | MiniText> = [];
  readonly attributes = new Map<string, string>();
  readonly style = new MiniStyle();
  readonly listeners = new Map<string, Set<Listener>>();
  className = "";
  id = "";
  clientWidth = 1280;
  scrollTop = 0;
  scrollLeft = 0;

  constructor(ownerDocument: MiniDocument, tagName: string) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
  }

  get children(): MiniElement[] {
    return this.childNodes.filter((node): node is MiniElement => node instanceof MiniElement);
  }

  get textContent(): string {
    return this.childNodes
      .map((node) => (node instanceof MiniText ? node.textContent : node.textContent))
      .join("");
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value !== "") {
      this.append(this.ownerDocument.createTextNode(value));
    }
  }

  get listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) {
      count += listeners.size;
    }
    return count;
  }

  append(...nodes: Array<MiniElement | MiniText | string>): void {
    for (const node of nodes) {
      const actual = typeof node === "string" ? this.ownerDocument.createTextNode(node) : node;
      if (actual.parentNode !== null) {
        actual.parentNode.childNodes = actual.parentNode.childNodes.filter(
          (candidate) => candidate !== actual,
        );
      }
      actual.parentNode = this;
      this.childNodes.push(actual);
    }
  }

  insertBefore(node: MiniElement | MiniText, reference: MiniElement | MiniText | null): void {
    if (node.parentNode !== null) {
      node.parentNode.childNodes = node.parentNode.childNodes.filter(
        (candidate) => candidate !== node,
      );
    }
    const index = reference === null ? this.childNodes.length : this.childNodes.indexOf(reference);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    node.parentNode = this;
  }

  replaceChildren(...nodes: Array<MiniElement | MiniText | string>): void {
    for (const node of this.childNodes) {
      node.parentNode = null;
    }
    this.childNodes = [];
    this.append(...nodes);
  }

  remove(): void {
    if (this.parentNode === null) {
      return;
    }
    this.parentNode.childNodes = this.parentNode.childNodes.filter(
      (candidate) => candidate !== this,
    );
    this.parentNode = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") {
      this.id = value;
    }
    if (name === "class") {
      this.className = value;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: Listener): void {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: MiniEvent): boolean {
    const actual: MiniEvent = { ...event, target: event.target ?? this };
    for (const listener of [...(this.listeners.get(actual.type) ?? [])]) {
      listener(actual);
    }
    return actual.defaultPrevented !== true;
  }

  click(): void {
    this.dispatchEvent({ type: "click" });
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }
}

export class MiniText {
  readonly nodeType = 3;
  readonly ownerDocument: MiniDocument;
  parentNode: MiniElement | null = null;
  textContent: string;

  constructor(ownerDocument: MiniDocument, textContent: string) {
    this.ownerDocument = ownerDocument;
    this.textContent = textContent;
  }

  remove(): void {
    if (this.parentNode === null) {
      return;
    }
    this.parentNode.childNodes = this.parentNode.childNodes.filter(
      (candidate) => candidate !== this,
    );
    this.parentNode = null;
  }
}

class MiniResizeObserver {
  private readonly callback: () => void;
  private readonly targets = new Set<MiniElement>();

  constructor(callback: () => void) {
    this.callback = callback;
  }

  observe(target: MiniElement): void {
    this.targets.add(target);
    if (!target.ownerDocument.resizeObservers.includes(this)) {
      target.ownerDocument.resizeObservers.push(this);
    }
  }

  disconnect(): void {
    this.targets.clear();
  }

  trigger(): void {
    if (this.targets.size > 0) {
      this.callback();
    }
  }

  get targetCount(): number {
    return this.targets.size;
  }
}

export class MiniDocument {
  readonly body: MiniElement;
  readonly resizeObservers: MiniResizeObserver[] = [];
  activeElement: MiniElement | null = null;
  readonly defaultView: {
    readonly innerWidth: number;
    readonly ResizeObserver: new (callback: () => void) => MiniResizeObserver;
  };

  constructor() {
    this.defaultView = {
      innerWidth: 1280,
      ResizeObserver: MiniResizeObserver,
    };
    this.body = new MiniElement(this, "body");
  }

  createElement(tagName: string): MiniElement {
    return new MiniElement(this, tagName);
  }

  createTextNode(textContent: string): MiniText {
    return new MiniText(this, textContent);
  }
}

export function createMiniDocument(): MiniDocument {
  return new MiniDocument();
}

export function allElements(root: MiniElement): MiniElement[] {
  const output: MiniElement[] = [];
  const visit = (element: MiniElement): void => {
    output.push(element);
    for (const child of element.children) {
      visit(child);
    }
  };
  visit(root);
  return output;
}

export function findByClass(root: MiniElement, className: string): MiniElement[] {
  return allElements(root).filter((element) => element.className.split(/\s+/).includes(className));
}

export function findByTag(root: MiniElement, tagName: string): MiniElement[] {
  return allElements(root).filter((element) => element.tagName === tagName.toUpperCase());
}

export function findByAttribute(root: MiniElement, name: string, value?: string): MiniElement[] {
  return allElements(root).filter((element) => {
    const actual = element.getAttribute(name);
    return actual !== null && (value === undefined || actual === value);
  });
}

export function textOf(element: MiniElement): string {
  return element.textContent;
}
