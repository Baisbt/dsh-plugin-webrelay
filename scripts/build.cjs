/**
 * 本地构建脚本（等价于 package.json 的 build 脚本）。
 * 同 check.cjs：绕开本机 Bash/PowerShell 的输出捕获问题。
 *
 * 加 --file 参数时改写进文件（避免终端输出被截断/捕获为空）。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const tsdown = path.join(root, 'node_modules', 'tsdown', 'dist', 'run.mjs')

const r = spawnSync(process.execPath, [tsdown], { cwd: root, encoding: 'utf8' })

const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
const text = (out.length > 0 ? `BUILD OUTPUT:\n${out}\n` : 'BUILD OUTPUT: (silent)\n') + `EXIT=${r.status}\n`

const fileArg = process.argv.indexOf('--file')
if (fileArg >= 0 && process.argv[fileArg + 1]) {
  fs.writeFileSync(process.argv[fileArg + 1], text, 'utf8')
  process.stdout.write(`written to ${process.argv[fileArg + 1]}\n`)
} else {
  process.stdout.write(text)
}
