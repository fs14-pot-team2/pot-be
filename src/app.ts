import { env } from "./config/env.js";
import cors from "cors";
import express from "express";

export const app = express();
app.disable("x-powered-by");

app.use(cors({ origin: env.corsOrigins, credentials: true }));

app.use(express.json());
app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});
