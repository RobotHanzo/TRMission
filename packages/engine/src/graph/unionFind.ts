/** Minimal Union-Find over string vertices (city ids). */
export class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();

  constructor(vertices?: Iterable<string>) {
    if (vertices) for (const v of vertices) this.add(v);
  }

  add(v: string): void {
    if (!this.parent.has(v)) {
      this.parent.set(v, v);
      this.rank.set(v, 0);
    }
  }

  find(v: string): string {
    this.add(v);
    let root = v;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    let cur = v;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const pa = this.rank.get(ra) ?? 0;
    const pb = this.rank.get(rb) ?? 0;
    if (pa < pb) this.parent.set(ra, rb);
    else if (pa > pb) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, pa + 1);
    }
  }

  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
}
