import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const QUESTIONS = [
  "Does it send my code anywhere?",
  "Which languages does it read?",
  "Does it cost tokens?",
  "Can I use it without Claude Code?",
  "Can I commit the grouping file?",
  "Why did my build fail?",
];
const FOOTER_FILES = ["LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.txt", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md"];

function section(readme: string, heading: string): string {
  const start = readme.indexOf(`\n${heading}\n`);
  if (start < 0) return "";
  const rest = readme.slice(start + heading.length + 2);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** One message per problem in the README's closing sections. */
export function footerProblems(readme: string, license: string, exists: (f: string) => boolean): string[] {
  const p: string[] = [];
  if (/^## Community$/m.test(readme)) p.push("## Community should be gone");
  const headings = readme.split("\n").filter((l) => /^## /.test(l));
  const docs = headings.indexOf("## Documentation");
  const tail = headings.slice(docs + 1);
  if (docs < 0 || tail.join("|") !== "## Privacy|## FAQ|## Contributing|## License")
    p.push("Privacy, FAQ, Contributing, License should follow Documentation, License last");
  const faq = section(readme, "## FAQ");
  const qs = faq.split("\n").filter((l) => l.startsWith("### ")).map((l) => l.slice(4));
  if (qs.join("|") !== QUESTIONS.join("|")) p.push("FAQ should have exactly the six questions");
  const priv = section(readme, "## Privacy");
  for (const l of ["](PRIVACY.md#where-things-run)", "](PRIVACY.md)", "](#is-it-safe-to-install)"])
    if (!priv.includes(l)) p.push(`Privacy should link ${l}`);
  const footer = section(readme, "## Contributing") + section(readme, "## License");
  for (const f of FOOTER_FILES) {
    if (!footer.includes(`](${f})`)) p.push(`footer should link ${f}`);
    if (!exists(f)) p.push(`${f} does not exist`);
  }
  if (/\/discussions/i.test(readme)) p.push("README should not link Discussions");
  if (!section(readme, "## License").includes(license)) p.push(`License should name ${license}`);
  if (!readme.includes('<a href="#faq">FAQ</a>')) p.push("header link row should link #faq");
  return p;
}

const readme = readFileSync(`${root}README.md`, "utf8");
const license = (JSON.parse(readFileSync(`${root}package.json`, "utf8")) as { license: string }).license;
const exists = (f: string) => existsSync(`${root}${f}`);

test("README closing sections are in place", () => {
  assert.deepEqual(footerProblems(readme, license, exists), []);
});

test("a removed question fails", () => {
  const bad = readme.replace("### Does it cost tokens?\n", "");
  assert.ok(footerProblems(bad, license, exists).some((m) => m.includes("six questions")));
});

test("a Discussions link fails", () => {
  const bad = readme + "\n[x](https://github.com/repoladder/repoladder/discussions)\n";
  assert.ok(footerProblems(bad, license, exists).some((m) => m.includes("Discussions")));
});

test("a missing license file link fails", () => {
  const bad = readme.replace("[NOTICE](NOTICE)", "NOTICE");
  assert.ok(footerProblems(bad, license, exists).some((m) => m.includes("NOTICE")));
});
