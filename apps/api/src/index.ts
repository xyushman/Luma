// Entry point: build the app, validate the port, then wire up graceful shutdown on OS signals.
import { createApp } from "./app.js";

import { prisma } from "./lib/prisma.js";

// Read PORT from env (default 4000) and convert it to a number so validation can reject junk.
const parsedPort = Number(process.env.PORT ?? 4000);
// Only trust a supplied port when it is an integer in the valid TCP range 1-65535; else fall back to 4000.
const port =
  Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535
    ? parsedPort
    : 4000;

// Start serving HTTP on the validated port and log the address once the listener is up.
const server = createApp().listen(port, () => {
  // Write a plain-text startup log so operators can immediately confirm the API is reachable.
  process.stdout.write(`api listening on http://localhost:${port}\n`);
});

// Drain in-flight work and release the DB before exiting, so deploys and Ctrl+C stay clean.
const gracefulShutdown = () => {
  // Announce shutdown so logs explain why the server is stopping.
  process.stdout.write("Shutting down gracefully...\n");
  // Stop accepting new connections and wait for open requests to finish before continuing.
  server.close(async () => {
    // Confirm the HTTP server has drained all requests.
    process.stdout.write("HTTP server closed.\n");
    try {
      // Release the Prisma/Postgres connection pool so no queries are left dangling.
      await prisma.$disconnect();
      // Log that the database connection was released successfully.
      process.stdout.write("Prisma connection closed.\n");
      // Exit with code 0 to signal a clean, successful shutdown.
      process.exit(0);
    } catch (err) {
      // Cleanup failed; still terminate, but with a nonzero code so orchestrators notice.
      process.stderr.write(`Error during shutdown: ${err}\n`);
      // Exit nonzero to flag an unclean shutdown to the process manager.
      process.exit(1);
    }
  });
};

// SIGTERM (sent by orchestrators kill/Terraform) triggers the graceful shutdown path.
process.on("SIGTERM", gracefulShutdown);
// SIGINT (Ctrl+C) triggers the same graceful shutdown path during interactive development.
process.on("SIGINT", gracefulShutdown);
