import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { globSync } from 'node:fs'

// 各レッスンの index.html を自動でビルド対象に含める
const lessonPages = globSync('src/**/index.html').reduce<Record<string, string>>(
  (entries, file) => {
    // 例: src/webgpu-fundamentals/01-fundamentals/index.html
    //     -> "webgpu-fundamentals/01-fundamentals"
    const name = file.replace(/^src\//, '').replace(/\/index\.html$/, '')
    entries[name] = resolve(import.meta.dirname, file)
    return entries
  },
  {},
)

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        ...lessonPages,
      },
    },
  },
})
