import "dotenv/config";
import { CONFIG } from "./config.js";
import { createServer } from "./server.js";

const app = createServer();

app.listen(CONFIG.port, () => {
  process.stdout.write(
    `a11y-github-app listening on port ${CONFIG.port}\nhealth: /health\nwebhook: /webhook\n`,
  );
});
