/**
 * diff-parse 解析器单元测试(Node 直跑,无 DOM)。
 * 覆盖:多文件、hunk 行号、删除+新增配对(change)、单侧增删、
 * no-newline 标记、新增/删除/重命名/二进制文件、无 diff --git 头的裸 patch。
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'dsh-cr-test-'))
const entry = join(dir, 'entry.mjs')
writeFileSync(entry, `
import { parseGitDiff, isDiffText, countStats, displayPath } from ${JSON.stringify(join(process.cwd(), 'src/client/diff-parse.ts'))}
import { buildStandaloneHtml } from ${JSON.stringify(join(process.cwd(), 'src/client/diff-view.ts'))}
globalThis.__test = { parseGitDiff, isDiffText, countStats, displayPath, buildStandaloneHtml }
`)
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(dir, 'out.mjs'),
  logLevel: 'silent',
})
await import('file://' + join(dir, 'out.mjs'))
const { parseGitDiff, isDiffText, countStats, displayPath, buildStandaloneHtml } = globalThis.__test

let failed = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`ok - ${name}`)
  } else {
    failed += 1
    console.log(`FAIL - ${name}\n  actual:   ${a}\n  expected: ${e}`)
  }
}
function checkTrue(name, actual) {
  if (actual) console.log(`ok - ${name}`)
  else { failed += 1; console.log(`FAIL - ${name}: got ${JSON.stringify(actual)}`) }
}

// 1. 典型双文件 git diff:修改 + 新增
const multi = `diff --git a/src/foo.ts b/src/foo.ts
index 1234567..89abcde 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,7 +10,8 @@ export function foo() {
   const a = 1
-  const b = 2
+  const b = 3
+  const c = 4
   return a + b
 }
diff --git a/src/bar.ts b/src/bar.ts
new file mode 100644
index 0000000..abcdef0
--- /dev/null
+++ b/src/bar.ts
@@ -0,0 +1,3 @@
+export const bar = 1
+export const baz = 2
+export default bar
`
{
  const files = parseGitDiff(multi)
  check('多文件解析:文件数', files.length, 2)
  const [f1, f2] = files
  check('文件1:类型', f1.status, 'modified')
  check('文件1:路径', [displayPath(f1.oldPath), displayPath(f1.newPath)], ['src/foo.ts', 'src/foo.ts'])
  check('文件1:行序列 kind', f1.rows.map((r) => r.kind), ['gap', 'ctx', 'change', 'add', 'ctx', 'ctx'])
  check('文件1:change 行号', [f1.rows[2].oldNo, f1.rows[2].newNo], [11, 11])
  check('文件1:add 行号', f1.rows[3].newNo, 12)
  check('文件1:gap 文本', f1.rows[0].gapText, '@@ -10,7 +10,8 @@ export function foo() {')
  check('文件2:类型', f2.status, 'added')
  check('文件2:路径', displayPath(f2.newPath), 'src/bar.ts')
  check('文件2:行序列 kind', f2.rows.map((r) => r.kind), ['gap', 'add', 'add', 'add'])
  check('文件2:add 行号', f2.rows.map((r) => r.newNo), [null, 1, 2, 3])
  check('统计', countStats(files), { added: 5, removed: 1, files: 2 })
}

// 2. 纯删除 + no-newline 标记
const del = `diff --git a/x.txt b/x.txt
--- a/x.txt
+++ b/x.txt
@@ -1,4 +1,3 @@
 line1
-removed line
\\ No newline at end of file
 line3
`
{
  const [file] = parseGitDiff(del)
  check('纯删除:行序列', file.rows.map((r) => r.kind), ['gap', 'ctx', 'del', 'ctx'])
  check('纯删除:del 行号', file.rows[2].oldNo, 2)
  check('no-newline:挂在 del 行旧侧', file.rows[2].oldNoEol, true)
  check('no-newline:ctx 不受影响', file.rows[3].oldNoEol, undefined)
}

// 3. 删除多于新增:多余删除退化为 del
const uneven = `diff --git a/y.ts b/y.ts
--- a/y.ts
+++ b/y.ts
@@ -1,5 +1,3 @@
 a
-rem1
-rem2
-rem3
+add1
 b
`
{
  const [file] = parseGitDiff(uneven)
  check('数量不等:行序列', file.rows.map((r) => r.kind), ['gap', 'ctx', 'change', 'del', 'del', 'ctx'])
  check('数量不等:change 行号(配对从头对齐)', [file.rows[2].oldNo, file.rows[2].newNo], [2, 2])
  check('数量不等:多余 del 行号', [file.rows[3].oldNo, file.rows[4].oldNo], [3, 4])
}

// 4. 新增多于删除:多余新增退化为 add
const uneven2 = `diff --git a/z.ts b/z.ts
--- a/z.ts
+++ b/z.ts
@@ -1,2 +1,4 @@
-rem1
+add1
+add2
+add3
`
{
  const [file] = parseGitDiff(uneven2)
  check('新增更多:行序列', file.rows.map((r) => r.kind), ['gap', 'change', 'add', 'add'])
  check('新增更多:change 行号', [file.rows[1].oldNo, file.rows[1].newNo], [1, 1])
  check('新增更多:add 行号', [file.rows[2].newNo, file.rows[3].newNo], [2, 3])
}

// 5. 删除文件 + 重命名
const rename = `diff --git a/old.ts b/new.ts
similarity index 95%
rename from old.ts
rename to new.ts
index abc..def 100644
--- a/old.ts
+++ b/new.ts
@@ -1 +1 @@
-old content
+new content
`
{
  const [file] = parseGitDiff(rename)
  check('重命名:状态', file.status, 'renamed')
  check('重命名:路径', [displayPath(file.oldPath), displayPath(file.newPath)], ['old.ts', 'new.ts'])
  check('重命名:meta', file.meta, ['similarity index 95%', 'rename from old.ts', 'rename to new.ts', 'index abc..def 100644'])
}

// 6. 二进制文件
{
  const [file] = parseGitDiff('diff --git a/img.png b/img.png\nindex 111..222 100644\nBinary files a/img.png and b/img.png differ\n')
  check('二进制:状态', file.status, 'binary')
  check('二进制:无行', file.rows.length, 0)
}

// 7. 多 hunk 同一文件
const multiHunk = `diff --git a/m.ts b/m.ts
--- a/m.ts
+++ b/m.ts
@@ -1,2 +1,2 @@
 a
 b
@@ -10,1 +10,1 @@
-c
+c2
`
{
  const [file] = parseGitDiff(multiHunk)
  check('多 hunk:行序列', file.rows.map((r) => r.kind), ['gap', 'ctx', 'ctx', 'gap', 'change'])
  check('多 hunk:第2个 gap', file.rows[3].gapText, '@@ -10,1 +10,1 @@')
  check('多 hunk:第2 hunk change 行号', [file.rows[4].oldNo, file.rows[4].newNo], [10, 10])
}

// 8. 无 diff --git 头的裸 patch(git diff --no-index 等)
const bare = `--- a/one.txt
+++ b/one.txt
@@ -1 +1,2 @@
 hello
+world
`
{
  const files = parseGitDiff(bare)
  check('裸 patch:文件数', files.length, 1)
  check('裸 patch:路径', [displayPath(files[0].oldPath), displayPath(files[0].newPath)], ['one.txt', 'one.txt'])
  check('裸 patch:行序列', files[0].rows.map((r) => r.kind), ['gap', 'ctx', 'add'])
}

// 9. 前置提交说明被跳过
const withCommit = `commit abcdef0123456789
Author: Test <t@example.com>

    chore: update foo

diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
-old
+new
`
{
  const files = parseGitDiff(withCommit)
  check('提交说明:文件数', files.length, 1)
  check('提交说明:解析正常', files[0].rows.map((r) => r.kind), ['gap', 'change'])
}

// 10. isDiffText 判定
checkTrue('isDiffText:标准头', isDiffText('diff --git a/x b/x\n@@ -1 +1 @@\n'))
checkTrue('isDiffText:hunk+标记', isDiffText('--- a/x\n+++ b/x\n@@ -1 +1 @@\n'))
check('isDiffText:纯 @@ 不算', isDiffText('@@ -1 +1 @@\n'), false)
check('isDiffText:普通文本不算', isDiffText('const a = 1\nconst b = 2\n'), false)

// 11. 独立标签页 HTML:转义 + 结构 + 主题注入
{
  const xssDiff = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-<script>alert("x")</script>\n+const a = 1 && 2\n'
  const files = parseGitDiff(xssDiff)
  const html = buildStandaloneHtml(files, { '--dsw-alias-bg-base': '#ffffff', '--ds-font-family-code': 'mono' }, xssDiff)
  checkTrue('standalone:脚本标签被转义', !html.includes('<script>alert'))
  checkTrue('standalone:& 被转义', html.includes('1 &amp;&amp; 2'))
  checkTrue('standalone:主题变量注入', html.includes('--dsw-alias-bg-base: #ffffff;'))
  checkTrue('standalone:统计条', html.includes('+1 −1 · 1 个文件'))
  checkTrue('standalone:文件导航', html.includes('<a class="navitem" href="#file-0">x</a>'))
  checkTrue('standalone:change 行', html.includes('dsh-cr-change'))
  checkTrue('standalone:行号', html.includes('dsh-cr-num-old">1<'))
  checkTrue('standalone:原始文本保留', html.includes('<pre class="rawpre">'))
  checkTrue('standalone:HTML 骨架', html.includes('<!doctype html>') && html.includes('</html>'))
}

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 个用例失败 ✗`)
process.exit(failed === 0 ? 0 : 1)
