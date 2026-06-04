import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          mantine: ["@mantine/core", "@mantine/hooks", "@mantine/notifications"],
          icons: ["@tabler/icons-react"],
        },
      },
    },
  },
});
