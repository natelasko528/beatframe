import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: 'dist-engine', emptyOutDir: true, lib: { entry: 'src/engine/standalone.ts', name: 'BeatFrameEngine', formats: ['iife'], fileName: () => 'beatframe-engine.js' } } });
