import assert from "node:assert/strict";
import { test } from "node:test";
import { presetById, PRESETS } from "../sim/presets.ts";
import { compileScenario } from "./flow.ts";
import { BACKEND_NAV } from "./nav.ts";
import { SNIPPETS } from "./snippets.generated.ts";
import { TOPICS } from "./topics/index.ts";

const has = (id: string) => id in SNIPPETS;

test("every topic has all four parts", () => {
  assert.equal(TOPICS.length, 12);
  for (const t of TOPICS) {
    assert.ok(t.learn.length >= 2, `${t.slug} learn`);
    assert.ok(t.flow.scenarios.length >= 1, `${t.slug} flow`);
    assert.ok(t.build.steps.length >= 2, `${t.slug} build`);
    assert.ok(t.build.integrate.length >= 2, `${t.slug} integrate`);
    assert.ok(t.build.mistakes.length >= 3, `${t.slug} mistakes`);
    assert.ok(t.simulate.tries.length >= 2, `${t.slug} tries`);
  }
});

test("every code reference points at a real tested snippet", () => {
  for (const t of TOPICS) {
    for (const s of t.build.steps) {
      for (const id of [s.code ?? []].flat()) assert.ok(has(id), `${t.slug}: ${id}`);
    }
    for (const sc of t.flow.scenarios) {
      for (const s of sc.steps) if (s.code) assert.ok(has(s.code), `${t.slug}: ${s.code}`);
    }
  }
});

test("every snippet from a topic folder is used in its guide", () => {
  const used = new Set(TOPICS.flatMap((t) => t.build.steps.flatMap((s) => [s.code ?? []].flat())));
  const unused = Object.keys(SNIPPETS).filter((id) => !used.has(id as never));
  assert.deepEqual(unused, []);
});

test("every flow compiles, and only refers to real nodes", () => {
  for (const t of TOPICS) {
    for (const sc of t.flow.scenarios) {
      const c = compileScenario(t.flow, sc);
      assert.equal(c.steps.length, sc.steps.length);
      for (const s of c.steps) {
        assert.ok(s.duration >= 1000, s.id);
        for (const h of s.hops) assert.ok(h.window[0] < h.window[1] && h.window[1] <= 1.01, `${s.id} window`);
        for (const r of s.card?.rows ?? []) assert.ok(r.at <= 1, `${s.id} row`);
      }
      assert.ok(c.edges.length > 0, sc.id);
    }
  }
});

test("node positions stay on the stage and do not overlap", () => {
  for (const t of TOPICS) {
    const ns = t.flow.nodes;
    assert.equal(new Set(ns.map((n) => n.id)).size, ns.length, t.slug);
    for (const n of ns) assert.ok(n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1, `${t.slug}/${n.id}`);
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const dx = Math.abs(ns[i]!.x - ns[j]!.x);
        const dy = Math.abs(ns[i]!.y - ns[j]!.y);
        assert.ok(dx > 0.11 || dy > 0.14, `${t.slug}: ${ns[i]!.id} overlaps ${ns[j]!.id}`);
      }
    }
  }
});

test("every simulate preset exists", () => {
  const ids = new Set(PRESETS.map((p) => p.id));
  for (const t of TOPICS) assert.ok(ids.has(t.simulate.preset), t.simulate.preset);
  assert.equal(presetById(TOPICS[1]!.simulate.preset).id, "cache");
});

test("the sidebar matches the topics exactly", () => {
  const nav = BACKEND_NAV.flatMap((g) => g.items.map((i) => i.slug)).sort();
  assert.deepEqual(nav, TOPICS.map((t) => t.slug).sort());
  for (const g of BACKEND_NAV) {
    for (const i of g.items) {
      const t = TOPICS.find((x) => x.slug === i.slug)!;
      assert.equal(t.group, g.group, t.slug);
      assert.equal(t.nav, i.label, t.slug);
    }
  }
});

test("page text never contains leftover template syntax", () => {
  const text = JSON.stringify(TOPICS);
  assert.ok(!/undefined|TODO|lorem/i.test(text));
});
