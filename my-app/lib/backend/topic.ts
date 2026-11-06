import type { FlowSpec } from "./flow.ts";
import type { SnippetId } from "./snippets.generated.ts";

export type Block =
  | { p: string }
  | { list: string[] }
  | { steps: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { callout: string; title?: string };

export interface LearnSection {
  heading: string;
  blocks: Block[];
}

export interface BuildStep {
  title: string;
  /** Why this step exists and what the important lines do. */
  explain: string[];
  code?: SnippetId | SnippetId[];
  /** Commands to run. These are not extracted from files. */
  shell?: string;
  /** Language of `shell` when it is not a terminal command. */
  shellLang?: string;
  /** Where this code belongs in the reader's own project. */
  where?: string;
}

export interface Build {
  intro: string;
  needs: string[];
  install?: string;
  tree?: string;
  steps: BuildStep[];
  /** Adding this to a project that already exists. */
  integrate: string[];
  mistakes: { title: string; text: string }[];
}

export type LabKind = "rate-limit" | "erasure" | "authz";

export interface Simulate {
  intro: string;
  preset: string;
  tries: string[];
  lab?: LabKind;
  labIntro?: string;
}

export interface Topic {
  slug: string;
  title: string;
  /** Sidebar name. */
  nav: string;
  group: "Foundations" | "Building blocks" | "Architecture" | "Traffic and security";
  lede: string;
  learn: LearnSection[];
  flow: FlowSpec;
  build: Build;
  simulate: Simulate;
  sources?: { label: string; url: string }[];
}
