import { watchReactApp } from "./build.mjs";

watchReactApp().then(({ dispose }) => {
  const shutdown = async () => {
    try {
      await dispose();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log("[react-app] watching frontend-src/react/src -> frontend-src/react/dist");
}).catch((error) => {
  console.error("[react-app] watch failed:", error);
  process.exitCode = 1;
});
