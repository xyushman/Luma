import { createApp } from "./app.js";

import { prisma } from "./lib/prisma.js";

const parsedPort = Number(process.env.PORT ?? 4000);
const port =
  Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535
    ? parsedPort
    : 4000;

const server = createApp().listen(port, () => {
  process.stdout.write(`api listening on http://localhost:${port}\n`);
});

const gracefulShutdown = () => {
  process.stdout.write("Shutting down gracefully...\n");
  server.close(async () => {
    process.stdout.write("HTTP server closed.\n");
    try {
      await prisma.$disconnect();
      process.stdout.write("Prisma connection closed.\n");
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error during shutdown: ${err}\n`);
      process.exit(1);
    }
  });
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
