/**
 * 浏览器半 bundle 的 Node 侧 mock 冒烟测试:
 * mock window.__ModuleLoader__ + 平台模块表 stub,调用 factory 验证
 * apply 注册不抛错、inject 列表正确、且 require 只命中模块表成员。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const bundlePath = require.resolve('../lib/client.js')
const code = readFileSync(bundlePath, 'utf8')

let failed = 0

// 1. 构建后自查:所有 require 必须是平台模块表成员。
const externals = [...code.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
const ALLOWED = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
])
for (const ext of externals) {
  if (!ALLOWED.has(ext)) {
    failed += 1
    console.log(`FAIL - 非模块表外部依赖: ${ext}`)
  }
}
console.log(`ok - require 调用均属模块表成员(${externals.length} 处)`)

// 2. mock 模块表 require(本 bundle 运行时只用到 react)。
const moduleTable = {
  react: { useEffect: () => {} },
}

// 3. 在 vm 沙箱里执行 bundle:顶层 __ModuleLoader__.load 会同步注册 factory。
let captured = null
const loader = {
  load: (opts) => {
    captured = opts
  },
}
vm.runInNewContext(code, { window: { __ModuleLoader__: loader }, console })
if (captured === null || typeof captured.factory !== 'function') {
  console.log('FAIL - bundle 未调用 __ModuleLoader__.load 注册工厂')
  process.exit(1)
}
console.log(`ok - __ModuleLoader__.load id = ${captured.id}`)

// 4. 调用工厂,校验导出面与 apply 行为。
const mod = captured.factory((name) => {
  if (!(name in moduleTable)) throw new Error(`模块表外 require: ${name}`)
  return moduleTable[name]
})
if (typeof mod.apply !== 'function') {
  failed += 1
  console.log('FAIL - 未导出 apply')
} else {
  console.log('ok - 导出 apply')
}
if (!Array.isArray(mod.inject) || mod.inject[0] !== 'slots') {
  failed += 1
  console.log(`FAIL - inject 不正确: ${JSON.stringify(mod.inject)}`)
} else {
  console.log(`ok - inject = ${JSON.stringify(mod.inject)}`)
}
const injected = []
const ctx = {
  slots: {
    inject: (name, fn) => {
      injected.push({ name, fn })
    },
  },
}
try {
  mod.apply(ctx)
  const names = injected.map((entry) => entry.name)
  if (!names.includes('shell.overlay') || !names.includes('conversation.session.header.actions')) {
    failed += 1
    console.log(`FAIL - 未注册全部 slot: ${JSON.stringify(names)}`)
  } else {
    console.log(`ok - apply 注册 ${names.join(' + ')}`)
  }
} catch (err) {
  failed += 1
  console.log(`FAIL - apply 抛错: ${err.message}`)
}

console.log(failed === 0 ? '\n冒烟测试全部通过 ✓' : `\n${failed} 项失败 ✗`)
process.exit(failed === 0 ? 0 : 1)
