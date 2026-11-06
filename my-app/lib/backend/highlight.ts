/**
 * A small synchronous syntax highlighter. Code blocks render on the server and
 * inside animated client components, so it cannot depend on async loading.
 */

export type TokenKind = "comment" | "string" | "keyword" | "number" | "fn" | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS: Record<string, string> = {
  ts: "import from export const let var function return async await if else for of in new class extends implements interface type try catch finally throw switch case default break continue while typeof instanceof as private readonly get set public static declare module this null undefined true false void",
  sql: "SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE INDEX ROLE POLICY GRANT ON TO ALTER ENABLE FORCE ROW LEVEL SECURITY USING WITH CHECK PRIMARY KEY REFERENCES NOT NULL DEFAULT IN LOGIN PASSWORD NOSUPERUSER NOBYPASSRLS uuid text",
  nginx: "upstream server listen server_name location proxy_pass proxy_set_header proxy_http_version proxy_connect_timeout proxy_read_timeout client_max_body_size root expires keepalive",
  yaml: "services image command ports environment volumes healthcheck test interval retries extra_hosts",
  bash: "docker npm npx curl cd mkdir",
};

const COMMENT: Record<string, RegExp> = {
  ts: /^(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/,
  sql: /^--[^\n]*/,
  nginx: /^#[^\n]*/,
  yaml: /^#[^\n]*/,
  bash: /^#[^\n]*/,
};

const STRING = /^("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/;
const NUMBER = /^\d[\d_.]*/;
const WORD = /^[A-Za-z_$][\w$]*/;

export function tokenize(code: string, lang: string): Token[] {
  const keywords = new Set((KEYWORDS[lang] ?? "").split(" "));
  const comment = COMMENT[lang] ?? COMMENT.bash!;
  const tokens: Token[] = [];
  let rest = code;

  const push = (kind: TokenKind, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
    rest = rest.slice(text.length);
  };

  while (rest.length) {
    const c = rest.match(comment);
    if (c) {
      push("comment", c[0]);
      continue;
    }
    const s = rest.match(STRING);
    if (s) {
      push("string", s[0]);
      continue;
    }
    const n = rest.match(NUMBER);
    if (n) {
      push("number", n[0]);
      continue;
    }
    const w = rest.match(WORD);
    if (w) {
      const word = w[0];
      const isCall = lang === "ts" && rest[word.length] === "(";
      push(keywords.has(word) ? "keyword" : isCall ? "fn" : "plain", word);
      continue;
    }
    push("plain", rest[0]!);
  }
  return tokens;
}
