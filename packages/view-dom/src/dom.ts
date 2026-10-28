export type ElementDocument = Pick<Document, "createElement" | "createTextNode">;

export function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: ElementDocument,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className !== undefined) {
    element.className = className;
  }
  return element;
}

export function setText(element: Element, text: string): void {
  element.textContent = text;
}

export function setKeyedText(
  element: Element,
  key: string,
  text: string,
  params?: readonly string[],
): void {
  element.textContent = text;
  element.setAttribute("data-message-key", key);
  if (params !== undefined && params.length > 0) {
    element.setAttribute("data-message-params", params.join(","));
  } else {
    element.removeAttribute("data-message-params");
  }
}

export function clearElement(element: Element): void {
  element.replaceChildren();
}

export function removeElement(element: Element): void {
  element.remove();
}

export function setHostText(element: Element, text: string): void {
  element.textContent = text;
  element.setAttribute("data-host-content", "");
}

export function setKeyedLabel(
  element: Element,
  key: string,
  text: string,
  params?: readonly string[],
): void {
  element.setAttribute("aria-label", text);
  element.setAttribute("data-message-key", key);
  if (params !== undefined && params.length > 0) {
    element.setAttribute("data-message-params", params.join(","));
  } else {
    element.removeAttribute("data-message-params");
  }
}

export function elementContains(ancestor: Element, node: Node | null): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (current === ancestor) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

export function descendantsByClass(root: Element, className: string): HTMLElement[] {
  const output: HTMLElement[] = [];
  const visit = (element: Element): void => {
    for (const child of element.children) {
      const htmlChild = child as HTMLElement;
      const attribute = child.getAttribute("class");
      const classNameValue = htmlChild.className;
      const rawClasses = attribute ?? (typeof classNameValue === "string" ? classNameValue : "");
      if (rawClasses.split(/\s+/).includes(className)) {
        output.push(htmlChild);
      }
      visit(child);
    }
  };
  visit(root);
  return output;
}
