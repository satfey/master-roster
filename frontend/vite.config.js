import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Without this file Vite runs with NO plugins, so esbuild falls back to the
// CLASSIC JSX transform (JSX -> React.createElement). Practically every
// component here relies on the automatic runtime and does not import React, so
// the whole app dies with "React is not defined" on first render — a blank page.
//
// `vite build` still SUCCEEDS in that state (it emits the broken bundle without
// executing it) and `vitest` still passes (it uses vitest.config.js, and every
// current test file is plain .js with no JSX), so neither one catches the loss.
// It was deleted by commit 07dffb6, which removed the team's earlier standalone
// frontend wholesale; the commit that restored App.jsx/main.jsx/package.json
// alongside it did not restore this config.
export default defineConfig({
  plugins: [react()],
});
