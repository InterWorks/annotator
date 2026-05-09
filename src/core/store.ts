import type { Annotation } from "./types.ts";

const KEY_PREFIX = "annotator_";

interface Persisted {
  annotations: Annotation[];
  nextId: number;
}

export class Store {
  private annotations: Annotation[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();
  private storageKey: string;

  constructor(scope: string = location.pathname) {
    this.storageKey = KEY_PREFIX + scope;
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw) as Persisted;
      this.annotations = Array.isArray(data.annotations) ? data.annotations : [];
      this.nextId =
        data.nextId ||
        (this.annotations.length ? Math.max(...this.annotations.map((a) => a.id)) + 1 : 1);
    } catch {
      this.annotations = [];
      this.nextId = 1;
    }
  }

  private persist() {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({ annotations: this.annotations, nextId: this.nextId } satisfies Persisted),
      );
    } catch {}
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): Annotation[] {
    return this.annotations;
  }

  count(): number {
    return this.annotations.length;
  }

  add(partial: Omit<Annotation, "id" | "timestamp" | "url">): Annotation {
    const a: Annotation = {
      ...partial,
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      url: location.href,
    };
    this.annotations.push(a);
    this.persist();
    return a;
  }

  update(id: number, patch: Partial<Annotation>): void {
    const idx = this.annotations.findIndex((a) => a.id === id);
    if (idx < 0) return;
    this.annotations[idx] = { ...this.annotations[idx]!, ...patch };
    this.persist();
  }

  remove(id: number): void {
    this.annotations = this.annotations.filter((a) => a.id !== id);
    this.persist();
  }

  clear(): void {
    this.annotations = [];
    this.nextId = 1;
    this.persist();
  }
}
