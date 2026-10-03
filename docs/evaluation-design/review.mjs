/* global process, console, document, innerWidth, URL */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Review the standalone design sketch. This never connects to Paperloop.
const root = fileURLToPath(new URL(".", import.meta.url));
const embedded = JSON.parse(
  readFileSync(`${root}/sketch.html`, "utf8").match(
    /<script type="application\/json" id="examples">([\s\S]*?)<\/script>/,
  )[1],
);
for (const name of ["application", "ml"]) {
  const plan = JSON.parse(
    readFileSync(`${root}/examples/${name}.json`, "utf8"),
  );
  assert.deepEqual(embedded[name], plan);
  assert.equal(plan.formatVersion, 2);
  assert.ok(plan.checks.length > 1);
  const prior = new Set();
  for (const check of plan.checks) {
    assert.ok(!prior.has(check.id));
    assert.ok(check.dependsOn.every((id) => prior.has(id)));
    assert.ok(check.command.timeoutMs <= plan.overallTimeoutMs);
    prior.add(check.id);
  }
}
const output = resolve(process.argv[2] ?? "test-results/evaluation-design");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  for (const [width, height] of [
    [360, 844],
    [390, 844],
    [768, 900],
    [1024, 768],
    [1440, 1000],
    [900, 500],
  ]) {
    await page.setViewportSize({ width, height });
    for (const scenario of ["application", "ml", "missing", "failure"]) {
      await page.goto(new URL("sketch.html", import.meta.url).href);
      await page.getByLabel("Preview scenario").selectOption(scenario);
      assert.ok(await page.getByRole("heading", { level: 1 }).isVisible());
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: `${output}/${scenario}-${width}x${height}.png`,
        fullPage: true,
      });
      if (scenario === "missing") {
        assert.equal(
          await page
            .getByRole("button", { name: "Review exact steps" })
            .count(),
          0,
        );
        await page
          .getByRole("button", { name: "Show single-command fallback" })
          .click();
        assert.match(
          await page.getByRole("status").textContent(),
          /coverage.*unknown/,
        );
      } else if (scenario === "failure") {
        assert.match(
          await page.locator(".notice").textContent(),
          /validation: failed.*inconclusive/,
        );
        assert.equal(
          await page
            .getByRole("button", { name: "Review exact steps" })
            .count(),
          0,
        );
      } else {
        await page
          .getByText("Adjust the goal (optional)", { exact: true })
          .click();
        await page.getByRole("button", { name: "Request a revision" }).click();
        assert.ok(
          await page
            .getByRole("button", { name: "Review exact steps" })
            .isDisabled(),
        );
        assert.match(
          await page.getByRole("status").textContent(),
          /Awaiting agent draft/,
        );
        await page
          .getByRole("button", { name: "Preview the fixed agent revision" })
          .click();
        assert.match(
          await page.getByRole("status").textContent(),
          /Version 2.*awaiting approval/,
        );
        await page.getByRole("button", { name: "Review exact steps" }).click();
        const dialog = page.getByRole("dialog");
        assert.ok(await dialog.isVisible());
        const approve = page.getByRole("button", {
          name: "Simulate approval of version 2",
        });
        await approve.scrollIntoViewIfNeeded();
        await approve.focus();
        const bounds = await approve.boundingBox();
        assert.ok(
          bounds && bounds.y >= 0 && bounds.y + bounds.height <= height,
        );
        await page.screenshot({
          path: `${output}/${scenario}-exact-${width}x${height}.png`,
          fullPage: false,
        });
        await approve.click();
        assert.match(
          await page.getByRole("status").textContent(),
          /Simulated approval.*No command has run/,
        );
      }
    }
  }
  // Arbitrary text must not be mislabeled as a structured revision.
  await page.goto(new URL("sketch.html", import.meta.url).href);
  await page.getByText("Adjust the goal (optional)", { exact: true }).click();
  await page
    .getByLabel("What would you change?")
    .fill("Add an unconfigured benchmark");
  await page.getByRole("button", { name: "Request a revision" }).click();
  await page
    .getByRole("button", { name: "Preview the fixed agent revision" })
    .click();
  assert.ok(
    await page.getByRole("button", { name: "Review exact steps" }).isDisabled(),
  );
  assert.match(
    await page.getByRole("status").textContent(),
    /needs an agent response/,
  );
  assert.deepEqual(errors, []);
  assert.ok(requests.every((url) => url.startsWith("file:")));
  console.log(
    "Design sketch review passed: two examples, six viewports, pending/revised approval, exact-step scrolling, fallback and failure states; no network requests.",
  );
} finally {
  await browser.close();
}
