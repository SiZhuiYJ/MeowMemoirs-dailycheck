/**
 * 依次运行本目录下的全部验证套件，并汇总结果。
 *   node tools/dev-verify/run-all.mjs
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { HERE, API } from "./config.mjs";

const suites = readdirSync(HERE)
  // `_` 开头的是共用模块（如 _fixtures.mjs），不是套件，别拿去跑
  .filter((file) => file.endsWith(".mjs")
    && !file.startsWith("_")
    && !["config.mjs", "run-all.mjs"].includes(file))
  .sort();

console.log(`\n目标后端: ${API}\n共 ${suites.length} 个套件\n${"=".repeat(56)}`);

const results = [];
for (const suite of suites) {
  const startedAt = Date.now();
  const run = spawnSync(process.execPath, [new URL(`./${suite}`, import.meta.url).pathname], {
    encoding: "utf8",
  });
  const failed = run.status !== 0;
  const passCount = (run.stdout?.match(/PASS/g) ?? []).length;
  const failCount = (run.stdout?.match(/FAIL/g) ?? []).length;
  results.push({ suite, failed, passCount, failCount, ms: Date.now() - startedAt });

  console.log(`${failed ? "✗" : "✓"} ${suite.padEnd(26)} 通过 ${String(passCount).padStart(3)}  失败 ${String(failCount).padStart(2)}  ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  if (failed) {
    // 失败时把该套件的输出打出来，便于定位
    console.log((run.stdout ?? "").split("\n").filter((l) => l.includes("FAIL")).map((l) => `    ${l.trim()}`).join("\n"));
    if (run.stderr) console.log(`    stderr: ${run.stderr.trim().split("\n").slice(-3).join(" | ")}`);
  }
}

const failedSuites = results.filter((r) => r.failed);
console.log("=".repeat(56));
console.log(
  failedSuites.length === 0
    ? `全部通过：${results.length} 个套件，共 ${results.reduce((n, r) => n + r.passCount, 0)} 项断言`
    : `失败套件：${failedSuites.map((r) => r.suite).join(", ")}`,
);
process.exit(failedSuites.length === 0 ? 0 : 1);
