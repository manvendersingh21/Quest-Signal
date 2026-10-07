import http from "node:http";
import { handler } from "./src/http/app.js";

const PORT = Number(process.env.PORT) || 4173;
const HOST = "0.0.0.0";

http.createServer(handler).listen(PORT, HOST, () => {
  console.log(`QuestSignal listening on http://127.0.0.1:${PORT}`);
});
