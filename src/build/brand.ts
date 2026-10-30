// The product's name and public links, in one place. The landing page is live (repoladder.com). The GitHub
// repo, plugin id and CLI binary are all named repoladder, and Discussions are still pending.
export const NAME = "RepoLadder";
/** Build tooling only: REPOLADDER_BRAND_NAME overrides NAME for recordings. Unset, it is NAME. */
export const brandName = (env: NodeJS.ProcessEnv = process.env): string => env.REPOLADDER_BRAND_NAME?.trim() || NAME;
export const REPO_URL = "https://github.com/repoladder/repoladder";
export const LANDING_URL = "https://repoladder.com/";
// Discussions are off for now, so the feedback issue template stands in.
// Switch to `${REPO_URL}/discussions` once they are on.
export const FEEDBACK_URL = `${REPO_URL}/issues/new?template=feedback.yml`;

/** The landing page link a diagram carries: that it came from a diagram, and nothing about who shared it. */
export const madeWithUrl = (): string => `${LANDING_URL}${LANDING_URL.includes("?") ? "&" : "?"}ref=diagram`;
