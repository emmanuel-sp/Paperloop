# GitHub repository selection

In Create project, choose GitHub to browse repositories owned by you or shared
with your account and organizations. Search includes public repositories and
private repositories authorized by your connection. You can also paste an HTTPS
`github.com/owner/repository` URL. Paperloop checks read access, shows the canonical
identity and visibility, and rechecks access before saving the project. Search is
paginated and bounded to 20 pages; narrow the search if necessary. GitHub search
may take time to index a new private repository; paste its URL to check it directly.

## Local sign-in

Install [GitHub CLI](https://cli.github.com/) on the computer running Paperloop and
run `gh auth login --hostname github.com` there. Paperloop uses the CLI's active
GitHub account and credential store. After signing in or using `gh auth switch`,
choose Retry connection in the picker. This is separate from connecting the browser
to the local Paperloop service. Paperloop does not create an account, receive
credentials from the browser, or put GitHub tokens in project data.

For least-privilege private access, use a fine-grained token restricted to the
selected repositories with Metadata read-only permission, configured through the
service process's `GH_TOKEN` environment. GitHub CLI's interactive login may request
broader scopes; Paperloop itself performs only read requests. Organization approval,
SSO policies and token access must permit the repository. Never put credentials in
repository URLs, project descriptions, or committed environment files. GitHub.com
is supported; GitHub Enterprise hosts are outside this integration's scope.

If the CLI is missing or disconnected, install/sign in locally and retry. An
expired sign-in needs renewal. A denied repository needs the correct account,
repository permissions or organization authorization. A rate limit needs time
before retrying. The picker preserves project fields during recovery, and local
directory selection remains available without GitHub access. Private repository
metadata is protected by the existing local service authentication and origin/host
checks. Subprocess errors are translated to fixed messages without returning or
logging credential diagnostics.

## Research context and execution

Selecting GitHub registers a read-only repository reference for research context.
It does not clone code or claim that files have been analyzed. Repository inference
belongs to the subsequent onboarding work. A checkout is not needed during setup.

When starting an experiment from a paper, a GitHub project asks for an existing
absolute local checkout path. The checkout needs a commit and an `origin` matching
the selected repository (HTTPS or GitHub SSH). Paperloop creates detached baseline
and candidate worktrees from the checkout's commit. The original checkout is not
edited and the project keeps its GitHub research reference and context provenance.
This step performs no clone, network Git operation or credential transfer to an
agent. Evaluation still needs exact workbench approval before an experiment can
be prepared. Local-directory projects retain their existing execution flow.

## Verification

`pnpm test` checks fixed-host read commands, sanitized disconnected/expired/denied/
rate-limit failures, URL validation, private access, pagination, service auth,
revoked access before persistence, approval and matching checkout isolation.
`pnpm test:browser` uses controlled GitHub responses with no real GitHub credentials
or paid calls, covering private search, pasted URLs, revoked-access retention and
retry, local fallback and contextual checkout guidance. Desktop/mobile picker
captures are saved under `test-results/foundations/github-picker-*.png`.
