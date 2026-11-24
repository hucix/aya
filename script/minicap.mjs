import path from 'path'
import { execFileSync } from 'node:child_process'
import normalizePath from 'licia/normalizePath.js'

// minicap is only needed for Android 4.4 (scrcpy requires API 21+).
// The prebuilt package ships armeabi-v7a binaries for SDK 19.
const version = '1.0.0'
const url = `https://registry.npmjs.org/minicap-prebuilt/-/minicap-prebuilt-${version}.tgz`
const root = normalizePath(path.resolve(__dirname, '..'))
const resourcesDir = path.join(root, 'resources')
const minicapDir = path.join(resourcesDir, 'minicap')
const archive = path.join(minicapDir, 'minicap-prebuilt.tgz')
const extracted = path.join(minicapDir, 'package')

await fs.ensureDir(minicapDir)
execFileSync('curl', ['-Lk', url, '-o', archive], { stdio: 'inherit' })
execFileSync('tar', ['-xzf', archive, '-C', minicapDir], { stdio: 'inherit' })

const platform = path.join(extracted, 'prebuilt', 'armeabi-v7a')
await fs.copy(
  path.join(platform, 'bin', 'minicap-nopie'),
  path.join(minicapDir, 'minicap')
)
await fs.copy(
  path.join(platform, 'lib', 'android-19', 'minicap.so'),
  path.join(minicapDir, 'minicap.so')
)
await fs.copy(path.join(extracted, 'LICENSE'), path.join(minicapDir, 'LICENSE'))

await fs.remove(archive)
await fs.remove(extracted)
