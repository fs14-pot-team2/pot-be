import cors from "cors";
import express from "express";
import { errorMiddleware } from "./middlewares/error-middleware.js";

export const app = express();
app.disable("x-powered-by");
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

app.use(errorMiddleware);
