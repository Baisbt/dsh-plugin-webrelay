/**
 * 本地自检脚本：跑 tsc 类型检查并把结果以 UTF-8 写到 stdout。
 * 单独成脚本的原因：本机 Git Bash 缺 coreutils，PowerShell 的输出捕获也返回空，
 * 只有走 Node 子进程才能拿到可读的 tsc 结果。
 *
 * 加 --file 参数时改写进文件（避免终端输出被截断/捕获为空）。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

const r = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.json'), '--noEmit'], {
  cwd: root,
  encoding: 'utf8',
})

const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
const text = (out.length > 0 ? `TSC OUTPUT:\n${out}\n` : 'TSC OUTPUT: (clean)\n') + `EXIT=${r.status}\n`

const fileArg = process.argv.indexOf('--file')
if (fileArg >= 0 && process.argv[fileArg + 1]) {
  fs.writeFileSync(process.argv[fileArg + 1], text, 'utf8')
  process.stdout.write(`written to ${process.argv[fileArg + 1]}\n`)
} else {
  process.stdout.write(text)
}
