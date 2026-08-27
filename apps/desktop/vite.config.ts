import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// In development the daemon runs separately; Vite forwards /api to it
// (start it with `bun dolly serve`, and set DOLLY_SERVE if not on 36559).
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: { "/api": process.env.DOLLY_SERVE ?? "http://127.0.0.1:36559" },
  },
});
