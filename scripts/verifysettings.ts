// Read-only check of a repo's GitHub settings against docs/public-repo-settings.md.
//
//   node scripts/verifysettings.ts <owner/repo> [--launch-week]
//
// Only GET requests through `gh api`. Needs a token with repo admin rights: without it the security
// fields are absent or 403/404, which is reported as CANNOT-VERIFY, never OFF.
// Exit 0: nothing OFF. Exit 1: at least one OFF. Exit 2: bad argument or no `gh`.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export type Status = "OK" | "OFF" | "CANNOT-VERIFY";
export type Result = { id: string; label: string; status: Status; detail: string };
export type Read = { status: number; body: unknown };
export type Runner = (endpoint: string) => Read;
export type Config = {
  defaultBranch: string;
  requiredChecks: string[];
  requireCodeOwnerReview: boolean;
  allowAutoMerge: boolean;
  allowedBypassActorTypes: string[];
  interactionLimit: { limit: string; expiry: string };
};

export const USAGE = `usage: node scripts/verifysettings.ts <owner/repo> [--launch-week]
Reads GitHub settings through \`gh api\` (GET only) and prints OK / OFF / CANNOT-VERIFY per check.
Needs a token with repo admin rights; without it security settings print CANNOT-VERIFY.
Exit 1 when anything is OFF, 2 on a bad argument.`;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const dig = (v: unknown, ...path: string[]): unknown => {
  let cur = v;
  for (const k of path) {
    const o = obj(cur);
    if (!o) return undefined;
    cur = o[k];
  }
  return cur;
};

// `gh api --include` output: status line, headers, blank line, body.
export function parseInclude(stdout: string): Read {
  const text = stdout.replace(/\r\n/g, "\n");
  const m = /^HTTP\/\S+\s+(\d{3})/.exec(text);
  const status = m ? Number(m[1]) : 0;
  const at = text.indexOf("\n\n");
  const raw = at >= 0 ? text.slice(at + 2).trim() : "";
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  return { status, body };
}

export function ghRunner(endpoint: string): Read {
  const r = spawnSync("gh", ["api", "--include", "-H", "X-GitHub-Api-Version: 2022-11-28", endpoint], { encoding: "utf8" });
  if (r.error) throw r.error;
  return parseInclude(r.stdout ?? "");
}

const ok = (id: string, label: string, detail = ""): Result => ({ id, label, status: "OK", detail });
const off = (id: string, label: string, detail: string): Result => ({ id, label, status: "OFF", detail });
const cant = (id: string, label: string, detail: string): Result => ({ id, label, status: "CANNOT-VERIFY", detail });

// Compare one field of a 200 response to an expected value. Anything but 200 or a missing field is CANNOT-VERIFY.
function field(r: Read, id: string, label: string, path: string[], want: unknown): Result {
  if (r.status !== 200) return cant(id, label, `HTTP ${r.status}`);
  const got = dig(r.body, ...path);
  if (got === undefined || got === null) return cant(id, label, `${path.join(".")} not returned`);
  return got === want ? ok(id, label) : off(id, label, `${path.join(".")} is ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function repoChecks(read: Runner, repo: string, cfg: Config): Result[] {
  const r = read(`repos/${repo}`);
  const out: Result[] = [];
  if (r.status !== 200) {
    for (const [id, label] of [
      ["merge-methods", "Squash and merge commits are allowed (no rebase)"],
      ["delete-branch-on-merge", "Head branches are deleted after merge"],
      ["discussions", "Discussions are on"],
      ["auto-merge", "Auto-merge is allowed"],
      ["secret-scanning", "Secret scanning is enabled"],
      ["push-protection", "Push protection for secrets is enabled"],
      ["dependabot-updates", "Dependabot security updates are enabled"],
    ]) out.push(cant(id, label, `HTTP ${r.status}`));
    return out;
  }
  const squash = dig(r.body, "allow_squash_merge"), merge = dig(r.body, "allow_merge_commit"), rebase = dig(r.body, "allow_rebase_merge");
  const label = "Squash and merge commits are allowed (no rebase)";
  if (squash === undefined || merge === undefined || rebase === undefined) out.push(cant("merge-methods", label, "merge settings not returned"));
  else if (squash === true && merge === true && rebase === false) out.push(ok("merge-methods", label));
  else out.push(off("merge-methods", label, `squash=${squash} merge-commit=${merge} rebase=${rebase}`));
  out.push(field(r, "delete-branch-on-merge", "Head branches are deleted after merge", ["delete_branch_on_merge"], true));
  out.push(field(r, "discussions", "Discussions are on", ["has_discussions"], true));
  out.push(field(r, "auto-merge", "Auto-merge is allowed", ["allow_auto_merge"], cfg.allowAutoMerge));
  out.push(field(r, "secret-scanning", "Secret scanning is enabled", ["security_and_analysis", "secret_scanning", "status"], "enabled"));
  out.push(field(r, "push-protection", "Push protection for secrets is enabled", ["security_and_analysis", "secret_scanning_push_protection", "status"], "enabled"));
  out.push(field(r, "dependabot-updates", "Dependabot security updates are enabled", ["security_and_analysis", "dependabot_security_updates", "status"], "enabled"));
  return out;
}

function actionsChecks(read: Runner, repo: string): Result[] {
  const w = read(`repos/${repo}/actions/permissions/workflow`);
  const f = read(`repos/${repo}/actions/permissions/fork-pr-contributor-approval`);
  return [
    field(w, "read-only-token", "Default workflow token is read-only", ["default_workflow_permissions"], "read"),
    field(w, "actions-create-prs", "Actions can open pull requests (the Version Packages PR)", ["can_approve_pull_request_reviews"], true),
    field(f, "fork-pr-approval", "Fork PR workflows need approval for all outside collaborators", ["approval_policy"], "all_external_contributors"),
  ];
}

function alertChecks(read: Runner, repo: string): Result[] {
  const label = "Dependabot alerts are enabled";
  const a = read(`repos/${repo}/vulnerability-alerts`);
  const alerts = a.status === 204 ? ok("dependabot-alerts", label) : a.status === 404 ? off("dependabot-alerts", label, "alerts are disabled (HTTP 404)") : cant("dependabot-alerts", label, `HTTP ${a.status}`);
  const pl = "Private vulnerability reporting is enabled";
  const p = read(`repos/${repo}/private-vulnerability-reporting`);
  let pvr: Result;
  if (p.status !== 200) pvr = cant("private-vuln-reporting", pl, `HTTP ${p.status}`);
  else {
    const en = dig(p.body, "enabled");
    pvr = en === true ? ok("private-vuln-reporting", pl) : en === false ? off("private-vuln-reporting", pl, "enabled is false") : cant("private-vuln-reporting", pl, "enabled not returned");
  }
  return [alerts, pvr];
}

const RULESET_IDS: Array<[string, string]> = [
  ["ruleset-exists", "A ruleset targets the default branch"],
  ["ruleset-active", "The ruleset is enforced (Active)"],
  ["ruleset-pr-required", "Pull requests are required"],
  ["ruleset-code-owner-review", "Code-owner review"],
  ["ruleset-required-checks", "Required status checks match the list"],
  ["ruleset-no-force-push", "Force pushes are blocked"],
  ["ruleset-no-delete", "Branch deletion is blocked"],
  ["ruleset-bot-only-bypass", "Only the bot may bypass the ruleset"],
];

function rulesetChecks(read: Runner, repo: string, cfg: Config): Result[] {
  const all = (status: Status, detail: string): Result[] => RULESET_IDS.map(([id, label]) => ({ id, label, status, detail }));
  const list = read(`repos/${repo}/rulesets?includes_parents=false`);
  if (list.status !== 200 || !Array.isArray(list.body)) return all("CANNOT-VERIFY", `rulesets list HTTP ${list.status}`);
  const branchRulesets = list.body.map(obj).filter((x): x is Obj => !!x && x.target === "branch");
  const details: Obj[] = [];
  for (const s of branchRulesets) {
    const d = read(`repos/${repo}/rulesets/${String(s.id)}`);
    const o = d.status === 200 ? obj(d.body) : null;
    if (o) details.push(o);
  }
  const targets = (d: Obj): boolean => {
    const inc = dig(d, "conditions", "ref_name", "include");
    return Array.isArray(inc) && inc.some((x) => x === "~DEFAULT_BRANCH" || x === `refs/heads/${cfg.defaultBranch}`);
  };
  const mine = details.filter((d) => targets(d) && d.enforcement !== "disabled");
  // An unreadable ruleset might be the one on main, or hold the rules we look for: don't guess OFF.
  if (details.length < branchRulesets.length) return all("CANNOT-VERIFY", "a ruleset's details are not readable");
  if (mine.length === 0) {
    const [first, ...rest] = all("CANNOT-VERIFY", "no ruleset to read");
    return [off(first.id, first.label, `no active ruleset targets ${cfg.defaultBranch}`), ...rest];
  }
  const noRules = mine.some((d) => !Array.isArray(d.rules));
  const noBypass = mine.some((d) => !Array.isArray(d.bypass_actors));
  const rules = mine.flatMap((d) => (Array.isArray(d.rules) ? d.rules.map(obj).filter((x): x is Obj => !!x) : []));
  const rule = (t: string): Obj | undefined => rules.find((x) => x.type === t);
  const L = Object.fromEntries(RULESET_IDS);
  const out: Result[] = [ok("ruleset-exists", L["ruleset-exists"])];
  out.push(mine.some((d) => d.enforcement === "active") ? ok("ruleset-active", L["ruleset-active"]) : off("ruleset-active", L["ruleset-active"], "enforcement is not active"));
  const ruleCant = (id: string): Result => cant(id, L[id], "rules not returned");
  const pr = rule("pull_request");
  if (noRules) out.push(ruleCant("ruleset-pr-required"));
  else out.push(pr ? ok("ruleset-pr-required", L["ruleset-pr-required"]) : off("ruleset-pr-required", L["ruleset-pr-required"], "no pull_request rule"));
  const co = pr ? dig(pr, "parameters", "require_code_owner_review") : undefined;
  if (noRules && cfg.requireCodeOwnerReview) out.push(ruleCant("ruleset-code-owner-review"));
  else if (!cfg.requireCodeOwnerReview) out.push(ok("ruleset-code-owner-review", L["ruleset-code-owner-review"], "not required yet"));
  else if (!pr) out.push(off("ruleset-code-owner-review", L["ruleset-code-owner-review"], "no pull_request rule"));
  else out.push(co === true ? ok("ruleset-code-owner-review", L["ruleset-code-owner-review"]) : off("ruleset-code-owner-review", L["ruleset-code-owner-review"], "code-owner review not required"));
  const sc = rule("required_status_checks");
  if (noRules) out.push(ruleCant("ruleset-required-checks"));
  else if (!sc) out.push(off("ruleset-required-checks", L["ruleset-required-checks"], "no required_status_checks rule"));
  else {
    const raw = dig(sc, "parameters", "required_status_checks");
    const have = new Set((Array.isArray(raw) ? raw : []).map((c) => dig(c, "context")).filter((c): c is string => typeof c === "string"));
    const missing = cfg.requiredChecks.filter((c) => !have.has(c));
    const extra = [...have].filter((c) => !cfg.requiredChecks.includes(c));
    const warn = extra.length ? `warning: not in the list: ${extra.join(", ")}` : "";
    out.push(missing.length ? off("ruleset-required-checks", L["ruleset-required-checks"], `missing: ${missing.join(", ")}${warn ? `; ${warn}` : ""}`) : ok("ruleset-required-checks", L["ruleset-required-checks"], warn));
  }
  if (noRules) out.push(ruleCant("ruleset-no-force-push"), ruleCant("ruleset-no-delete"));
  else out.push(rule("non_fast_forward") ? ok("ruleset-no-force-push", L["ruleset-no-force-push"]) : off("ruleset-no-force-push", L["ruleset-no-force-push"], "no non_fast_forward rule"), rule("deletion") ? ok("ruleset-no-delete", L["ruleset-no-delete"]) : off("ruleset-no-delete", L["ruleset-no-delete"], "no deletion rule"));
  const actors = mine.flatMap((d) => (Array.isArray(d.bypass_actors) ? d.bypass_actors.map(obj).filter((x): x is Obj => !!x) : []));
  const bid = "ruleset-bot-only-bypass";
  if (noBypass) out.push(cant(bid, L[bid], "bypass_actors not returned"));
  else if (actors.length === 0) out.push(off(bid, L[bid], "bypass list is empty; rebuild-dist.yml cannot push"));
  else {
    const bad = actors.map((a) => String(a.actor_type)).filter((t) => !cfg.allowedBypassActorTypes.includes(t));
    out.push(bad.length ? off(bid, L[bid], `bypass actor types not allowed: ${[...new Set(bad)].join(", ")}`) : ok(bid, L[bid]));
  }
  return out;
}

function launchCheck(read: Runner, repo: string, cfg: Config, now: number): Result {
  const id = "interaction-limit", label = "Interaction limit is set for launch week";
  const r = read(`repos/${repo}/interaction-limits`);
  if (r.status !== 200) return cant(id, label, `HTTP ${r.status}`);
  const limit = dig(r.body, "limit");
  if (typeof limit !== "string" || limit === "") return off(id, label, "no interaction limit is set");
  if (limit !== cfg.interactionLimit.limit) return off(id, label, `limit is ${limit}, want ${cfg.interactionLimit.limit}`);
  const exp = dig(r.body, "expires_at");
  if (typeof exp !== "string" || !(Date.parse(exp) > now)) return off(id, label, "limit has expired");
  return ok(id, label);
}

export function evaluate(read: Runner, repo: string, cfg: Config, opts: { launchWeek: boolean; now?: number }): Result[] {
  const out = [...repoChecks(read, repo, cfg), ...actionsChecks(read, repo), ...alertChecks(read, repo), ...rulesetChecks(read, repo, cfg)];
  if (opts.launchWeek) out.push(launchCheck(read, repo, cfg, opts.now ?? Date.now()));
  return out;
}

export const CHECK_IDS: string[] = [
  "merge-methods", "delete-branch-on-merge", "discussions", "auto-merge", "secret-scanning", "push-protection", "dependabot-updates",
  "read-only-token", "actions-create-prs", "fork-pr-approval", "dependabot-alerts", "private-vuln-reporting",
  ...RULESET_IDS.map(([id]) => id), "interaction-limit",
];

export function format(results: Result[]): { text: string; code: number } {
  const lines = results.map((r) =>
    r.status === "OK" ? `OK   ${r.id}  ${r.label}${r.detail ? ` (${r.detail})` : ""}`
      : r.status === "OFF" ? `OFF  ${r.id}  ${r.label} — ${r.detail}`
        : `??   ${r.id}  ${r.label} — cannot verify: ${r.detail}`);
  const n = (s: Status) => results.filter((r) => r.status === s).length;
  lines.push(`${n("OK")} ok, ${n("OFF")} off, ${n("CANNOT-VERIFY")} cannot verify`);
  if (n("OFF") > 0) lines.push("Fix: docs/public-repo-settings.md");
  return { text: lines.join("\n"), code: n("OFF") > 0 ? 1 : 0 };
}

export function parseArgs(argv: string[]): { repo: string; launchWeek: boolean } | null {
  const launchWeek = argv.includes("--launch-week");
  const rest = argv.filter((a) => a !== "--launch-week");
  if (rest.length !== 1 || !/^[\w.-]+\/[\w.-]+$/.test(rest[0])) return null;
  return { repo: rest[0], launchWeek };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    process.exit(2);
  }
  const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("./public-repo-settings.json", import.meta.url)), "utf8")) as Config;
  try {
    const { text, code } = format(evaluate(ghRunner, args.repo, cfg, { launchWeek: args.launchWeek }));
    console.log(text);
    process.exit(code);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("gh (GitHub CLI) is not installed or not on PATH");
      process.exit(2);
    }
    throw e;
  }
}
