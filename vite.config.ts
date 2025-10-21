import { defineConfig } from 'vite'

export default defineConfig({
    root: './src/main/resources/public', // your source files
    build: {
        outDir: './dist',
        emptyOutDir: true
    }
})
