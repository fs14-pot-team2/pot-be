import { env } from "./config/env.js";
import { app } from "./app.js";

const port = env.port;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT는 1부터 65535 사이의 정수여야 합니다.");
}
app.listen(port, () => {
  console.log(`POT API is running on http://localhost:${port}`);
});
