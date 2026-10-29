import { env } from "./config/env.js";
import cors from "cors";
import express from "express";
import { careRequestRouter } from "./routes/care-request-routes.js";
import { errorMiddleware } from "./middlewares/error-middleware.js";
import authRoutes from "./routes/auth-routes.js";

export const app = express();
app.disable("x-powered-by");

app.use(cors({ origin: env.corsOrigins, credentials: true }));

app.use(express.json());
app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});
app.use("/care-requests", careRequestRouter);

app.use("/auth", authRoutes);

app.use(errorMiddleware);
