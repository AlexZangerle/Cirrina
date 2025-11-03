import { defineConfig } from 'vite'

export default defineConfig({
    root: './src/main/resources/public',
    build: {
        outDir: './dist',
        emptyOutDir: true
    }
})
