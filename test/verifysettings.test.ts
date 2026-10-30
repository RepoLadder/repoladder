import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHECK_IDS, evaluate, format, parseArgs, parseInclude, type Config, type Read, type Result, type Runner } from "../scripts/verifysettings.ts";

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const cfg = JSON.parse(readFileSync(root("scripts/public-repo-settings.json"), "utf8")) as Config;
const R = "o/r";
const NOW = Date.parse("2026-11-01T00:00:00Z");

const rs = (over: Record<string, unknown> = {}) => ({
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  bypass_actors: [{ actor_id: 15368, actor_type: "Integration", bypass_mode: "always" }],
  rules: [
    { type: "pull_request", parameters: { require_code_owner_review: false } },
    { type: "required_status_checks", parameters: { required_status_checks: cfg.requiredChecks.map((context) => ({ context })) } },
    { type: "non_fast_forward" },
    { type: "deletion" },
  ],
  ...over,
});

function green(): Record<string, Read> {
  return {
    [`repos/${R}`]: { status: 200, body: {
      allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true, has_discussions: true,
      security_and_analysis: {
        secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" }, dependabot_security_updates: { status: "enabled" },
      },
    } },
    [`repos/${R}/actions/permissions/workflow`]: { status: 200, body: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false } },
    [`repos/${R}/actions/permissions/fork-pr-contributor-approval`]: { status: 200, body: { approval_policy: "all_external_contributors" } },
    [`repos/${R}/vulnerability-alerts`]: { status: 204, body: null },
    [`repos/${R}/private-vulnerability-reporting`]: { status: 200, body: { enabled: true } },
    [`repos/${R}/rulesets?includes_parents=false`]: { status: 200, body: [{ id: 7, target: "branch" }] },
    [`repos/${R}/rulesets/7`]: { status: 200, body: rs() },
    [`repos/${R}/interaction-limits`]: { status: 200, body: { limit: "existing_users", expires_at: "2026-11-05T00:00:00Z" } },
  };
}

function run(map: Record<string, Read>, launchWeek = false): { results: Result[]; asked: string[] } {
  const asked: string[] = [];
  const runner: Runner = (e) => {
    asked.push(e);
    return map[e] ?? { status: 404, body: { message: "Not Found" } };
  };
  return { results: evaluate(runner, R, cfg, { launchWeek, now: NOW }), asked };
}
const by = (rs_: Result[], id: string) => rs_.find((r) => r.id === id)!;
const withRuleset = (body: unknown): Record<string, Read> => ({ ...green(), [`repos/${R}/rulesets/7`]: { status: 200, body } });

test("a fully green repo is all OK and exits 0", () => {
  const { results } = run(green());
  assert.deepEqual(results.filter((r) => r.status !== "OK"), []);
  assert.equal(format(results).code, 0);
});

test("each OFF condition is reported OFF", () => {
  const g = green();
  const repo = (o: Record<string, unknown>) => ({ ...g, [`repos/${R}`]: { status: 200, body: { ...(g[`repos/${R}`].body as object), ...o } } });
  assert.equal(by(run(repo({ allow_merge_commit: true })).results, "squash-only").status, "OFF");
  assert.equal(by(run(repo({ delete_branch_on_merge: false })).results, "delete-branch-on-merge").status, "OFF");
  assert.equal(by(run(repo({ security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "disabled" }, dependabot_security_updates: { status: "enabled" } } })).results, "push-protection").status, "OFF");
  assert.equal(by(run({ ...g, [`repos/${R}/actions/permissions/workflow`]: { status: 200, body: { default_workflow_permissions: "write", can_approve_pull_request_reviews: true } } }).results, "read-only-token").status, "OFF");
  assert.equal(by(run({ ...g, [`repos/${R}/actions/permissions/workflow`]: { status: 200, body: { default_workflow_permissions: "read", can_approve_pull_request_reviews: true } } }).results, "no-actions-approve-prs").status, "OFF");
  assert.equal(by(run({ ...g, [`repos/${R}/actions/permissions/fork-pr-contributor-approval`]: { status: 200, body: { approval_policy: "first_time_contributors" } } }).results, "fork-pr-approval").status, "OFF");
  const noFf = rs(); (noFf.rules as unknown[]).splice(2, 1);
  const r1 = run(withRuleset(noFf)).results;
  assert.equal(by(r1, "ruleset-no-force-push").status, "OFF");
  assert.equal(format(r1).code, 1);
  const missing = rs({ rules: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "check" }] } }] });
  const r2 = by(run(withRuleset(missing)).results, "ruleset-required-checks");
  assert.equal(r2.status, "OFF");
  assert.match(r2.detail, /missing: changes/);
  assert.match(r2.detail, /warning: not in the list: check/);
  assert.equal(by(run(withRuleset(rs({ enforcement: "evaluate" }))).results, "ruleset-active").status, "OFF");
});

test("bypass is bot-only", () => {
  for (const t of ["RepositoryRole", "OrganizationAdmin", "Team", "User"]) {
    const r = by(run(withRuleset(rs({ bypass_actors: [{ actor_type: "Integration" }, { actor_type: t }] }))).results, "ruleset-bot-only-bypass");
    assert.equal(r.status, "OFF", t);
    assert.match(r.detail, new RegExp(t));
  }
  const e = by(run(withRuleset(rs({ bypass_actors: [] }))).results, "ruleset-bot-only-bypass");
  assert.equal(e.status, "OFF");
  assert.match(e.detail, /rebuild-dist\.yml cannot push/);
  assert.equal(by(run(withRuleset(rs({ bypass_actors: [{ actor_type: "DeployKey" }] }))).results, "ruleset-bot-only-bypass").status, "OK");
});

test("code-owner review is only a requirement when the data flag is on", () => {
  assert.equal(by(run(green()).results, "ruleset-code-owner-review").detail, "not required yet");
  const on = { ...cfg, requireCodeOwnerReview: true };
  const asked: string[] = [];
  const m = green();
  const res = evaluate((e) => (asked.push(e), m[e] ?? { status: 404, body: null }), R, on, { launchWeek: false });
  assert.equal(by(res, "ruleset-code-owner-review").status, "OFF");
});

test("what the token cannot read is CANNOT-VERIFY, never OFF", () => {
  const m: Record<string, Read> = {
    [`repos/${R}`]: { status: 200, body: { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true, has_discussions: true } },
    [`repos/${R}/actions/permissions/workflow`]: { status: 200, body: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false } },
    [`repos/${R}/actions/permissions/fork-pr-contributor-approval`]: { status: 422, body: {} },
    [`repos/${R}/vulnerability-alerts`]: { status: 403, body: {} },
    [`repos/${R}/private-vulnerability-reporting`]: { status: 404, body: {} },
    [`repos/${R}/rulesets?includes_parents=false`]: { status: 403, body: {} },
  };
  const { results } = run(m);
  for (const id of ["secret-scanning", "push-protection", "dependabot-updates", "fork-pr-approval", "dependabot-alerts", "private-vuln-reporting", ...CHECK_IDS.filter((i) => i.startsWith("ruleset-"))]) {
    assert.equal(by(results, id).status, "CANNOT-VERIFY", id);
  }
  assert.equal(results.filter((r) => r.status === "OFF").length, 0);
  assert.equal(format(results).code, 0);
});

test("vulnerability-alerts: 204 is OK and 404 is OFF", () => {
  assert.equal(by(run(green()).results, "dependabot-alerts").status, "OK");
  assert.equal(by(run({ ...green(), [`repos/${R}/vulnerability-alerts`]: { status: 404, body: null } }).results, "dependabot-alerts").status, "OFF");
});

test("no ruleset on the default branch is OFF and the rest cannot be read", () => {
  const m = { ...green(), [`repos/${R}/rulesets?includes_parents=false`]: { status: 200, body: [] as unknown[] } };
  const { results } = run(m);
  assert.equal(by(results, "ruleset-exists").status, "OFF");
  assert.equal(by(results, "ruleset-no-delete").status, "CANNOT-VERIFY");
});

test("the interaction limit is only requested with --launch-week", () => {
  assert.ok(!run(green(), false).asked.some((e) => e.includes("interaction")));
  assert.ok(!run(green(), false).results.some((r) => r.id === "interaction-limit"));
  const on = run(green(), true);
  assert.equal(by(on.results, "interaction-limit").status, "OK");
  const g = green();
  const lim = (b: unknown): Record<string, Read> => ({ ...g, [`repos/${R}/interaction-limits`]: { status: 200, body: b } });
  assert.equal(by(run(lim({}), true).results, "interaction-limit").status, "OFF");
  assert.equal(by(run(lim({ limit: "existing_users", expires_at: "2026-10-01T00:00:00Z" }), true).results, "interaction-limit").status, "OFF");
  assert.equal(by(run(lim({ limit: "collaborators_only", expires_at: "2026-11-05T00:00:00Z" }), true).results, "interaction-limit").status, "OFF");
});

test("only GET-style read endpoints are requested", () => {
  const { asked } = run(green(), true);
  assert.ok(asked.length > 0);
  for (const e of asked) assert.match(e, /^repos\/o\/r(\/[a-z/-]+|\/rulesets\/\d+|\?.*)?(\?[\w=&]+)?$/, e);
  assert.ok(asked.every((e) => !e.startsWith("-") && !/\s/.test(e)));
});

test("parseInclude reads status and body", () => {
  assert.deepEqual(parseInclude('HTTP/2.0 200 OK\nContent-Type: application/json\n\n{"a":1}'), { status: 200, body: { a: 1 } });
  assert.deepEqual(parseInclude("HTTP/2.0 204 No Content\nX-A: b\n\n"), { status: 204, body: null });
  assert.deepEqual(parseInclude('HTTP/2.0 404 Not Found\r\nX: y\r\n\r\n{"message":"Not Found"}'), { status: 404, body: { message: "Not Found" } });
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs(["a/b", "--launch-week"]), { repo: "a/b", launchWeek: true });
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(["nope"]), null);
  assert.equal(parseArgs(["a/b", "c/d"]), null);
});

test("drift guard: required checks are real job display names in ci.yml", () => {
  const ci = readFileSync(root(".github/workflows/ci.yml"), "utf8");
  const jobs = ci.slice(ci.indexOf("\njobs:"));
  const names = new Set<string>();
  for (const m of jobs.matchAll(/^ {4}name: (.+)$/gm)) {
    const n = m[1].trim();
    if (n.includes("${{ matrix.os }}")) for (const os of ["ubuntu-latest", "windows-latest"]) names.add(n.replace("${{ matrix.os }}", os));
    else names.add(n);
  }
  for (const c of cfg.requiredChecks) assert.ok(names.has(c), `${c} is not a job name in ci.yml`);
  assert.ok(cfg.requiredChecks.includes("changes"));
  assert.ok(!cfg.requiredChecks.includes("gallery default-grouping gate"));
  assert.ok(!cfg.requiredChecks.includes("plugin install (windows-latest)"));
});

test("drift guard: the checklist names every required check and every check id", () => {
  const doc = readFileSync(root("docs/public-repo-settings.md"), "utf8");
  for (const c of cfg.requiredChecks) assert.ok(doc.includes(c), `doc lacks required check ${c}`);
  for (const id of CHECK_IDS) assert.ok(doc.includes(`\`${id}\``), `doc lacks check id ${id}`);
});

test("a ruleset response without rules or bypass_actors (non-admin token) is CANNOT-VERIFY, not OFF", () => {
  const { rules: _r, bypass_actors: _b, ...bare } = rs();
  const results = run(withRuleset(bare)).results;
  for (const id of ["ruleset-pr-required", "ruleset-required-checks", "ruleset-no-force-push", "ruleset-no-delete", "ruleset-bot-only-bypass"]) {
    assert.equal(by(results, id).status, "CANNOT-VERIFY", id);
  }
  assert.equal(format(results).code, 0);
});

test("a branch ruleset whose details cannot be read makes the ruleset checks CANNOT-VERIFY", () => {
  const map = green();
  map[`repos/${R}/rulesets?includes_parents=false`] = { status: 200, body: [{ id: 7, target: "branch" }, { id: 8, target: "branch" }] };
  map[`repos/${R}/rulesets/8`] = { status: 403, body: { message: "Forbidden" } };
  const results = run(map).results;
  assert.deepEqual(results.filter((r) => r.id.startsWith("ruleset-") && r.status !== "CANNOT-VERIFY"), []);
});
