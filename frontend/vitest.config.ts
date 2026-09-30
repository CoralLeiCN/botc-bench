import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/integration/**/*.test.tsx"],
    setupFiles: ["./tests/integration/setup.ts"],
    restoreMocks: true,
  },
});
