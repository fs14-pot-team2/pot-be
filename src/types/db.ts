import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";

export type DbClient = typeof prisma | Prisma.TransactionClient;

export type TransactionRunner = <T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;
